"""Shared test fixtures for Stoa backend tests.

Provides mock Supabase client, mock httpx responses, and FastAPI test client
with auth overrides. All external services are mocked to enable offline testing.
"""

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone
from types import ModuleType

import pytest
from fastapi.testclient import TestClient

# Ensure backend is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# --- Stub missing third-party modules so `from main import app` works ---
# These modules may not be installed in the test environment.

for mod_name in ("trafilatura", "trafilatura.metadata", "fitz", "anthropic", "bibtexparser"):
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

# Set dummy env vars so Supabase client creation doesn't fail at import time.
# The actual Supabase client is always mocked in tests.
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")


# --- Mock Supabase ---

class MockSupabaseResponse:
    """Mimics supabase-py .execute() response."""
    def __init__(self, data=None, error=None):
        self.data = data or []
        self.error = error
        self.count = len(self.data)


class MockQueryBuilder:
    """Chainable query builder that returns MockSupabaseResponse.

    When insert() or upsert() is called, the inserted data (augmented with
    a fake id) is captured so execute() returns it, simulating a real
    Supabase insert response.
    """
    def __init__(self, data=None):
        self._data = data or []
        self._insert_data = None

    def select(self, *args, **kwargs): return self
    def insert(self, data, **kwargs):
        if isinstance(data, dict):
            self._insert_data = [{**data, "id": data.get("id", "mock-uuid-auto")}]
        elif isinstance(data, list):
            self._insert_data = [{**d, "id": d.get("id", f"mock-uuid-{i}")} for i, d in enumerate(data)]
        return self
    def upsert(self, data, **kwargs):
        if isinstance(data, dict):
            self._insert_data = [{**data, "id": data.get("id", "mock-uuid-upsert")}]
        return self
    def update(self, *args, **kwargs): return self
    def delete(self, *args, **kwargs): return self
    def eq(self, *args, **kwargs): return self
    def neq(self, *args, **kwargs): return self
    def ilike(self, *args, **kwargs): return self
    def in_(self, *args, **kwargs): return self
    def lte(self, *args, **kwargs): return self
    def gte(self, *args, **kwargs): return self
    def order(self, *args, **kwargs): return self
    def limit(self, *args, **kwargs): return self

    def execute(self):
        # If data was inserted/upserted, return that; otherwise return configured data
        if self._insert_data is not None:
            return MockSupabaseResponse(data=self._insert_data)
        return MockSupabaseResponse(data=self._data)


class MockSupabaseClient:
    """Mock Supabase client that returns configurable data."""
    def __init__(self, default_data=None):
        self._default_data = default_data or []
        self._table_data = {}
        self.auth = MagicMock()
        self.storage = MagicMock()

    def table(self, name):
        data = self._table_data.get(name, self._default_data)
        return MockQueryBuilder(data)

    def rpc(self, name, params=None):
        return MockQueryBuilder(self._default_data)

    def set_table_data(self, table_name, data):
        """Configure response data for a specific table."""
        self._table_data[table_name] = data


# --- Fixtures ---

@pytest.fixture
def mock_supabase():
    """Provides a MockSupabaseClient and patches get_supabase_service."""
    client = MockSupabaseClient()
    with patch("services.auth.get_supabase_service", return_value=client):
        yield client


@pytest.fixture
def mock_supabase_with_item():
    """Provides a MockSupabaseClient pre-loaded with a sample item."""
    client = MockSupabaseClient()
    sample_item = {
        "id": "item-uuid-1234",
        "user_id": "test-user-123",
        "url": "https://example.com/article",
        "title": "Test Article",
        "type": "blog",
        "domain": "example.com",
        "extracted_text": "This is the extracted text of the article.",
        "reading_status": "to_read",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    client.set_table_data("items", [sample_item])
    with patch("services.auth.get_supabase_service", return_value=client):
        yield client


@pytest.fixture
def dev_mode_env():
    """Sets STOA_DEV_MODE for the duration of the test."""
    with patch.dict(os.environ, {"STOA_DEV_MODE": "1"}):
        yield


@pytest.fixture
def no_dev_mode_env():
    """Ensures STOA_DEV_MODE is NOT set."""
    env = os.environ.copy()
    env.pop("STOA_DEV_MODE", None)
    with patch.dict(os.environ, env, clear=True):
        yield


@pytest.fixture
def test_client(dev_mode_env, mock_supabase):
    """FastAPI TestClient with dev mode enabled and Supabase mocked.

    Patches get_supabase_service at every import site so lru_cache
    and direct imports from routers all return the mock client.
    """
    # Patch at every import location where get_supabase_service is used
    patches = [
        patch("routers.ingest.get_supabase_service", return_value=mock_supabase),
        patch("routers.citations.get_supabase_service", return_value=mock_supabase),
        patch("routers.review.get_supabase_service", return_value=mock_supabase),
        patch("routers.highlights.get_supabase_service", return_value=mock_supabase),
    ]
    for p in patches:
        p.start()
    from main import app
    client = TestClient(app)
    yield client
    for p in patches:
        p.stop()


@pytest.fixture
def mock_openai_embeddings():
    """Mocks the OpenAI embeddings API call in embed_texts."""
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "data": [{"embedding": [0.1] * 1536}],
        "model": "text-embedding-3-small",
        "usage": {"prompt_tokens": 10, "total_tokens": 10},
    }
    mock_response.status_code = 200

    with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            yield


@pytest.fixture
def mock_httpx_get():
    """Mocks httpx.AsyncClient.get for URL fetching."""
    mock_response = MagicMock()
    mock_response.text = "<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>"
    mock_response.url = "https://example.com/article"
    mock_response.status_code = 200
    mock_response.content = b"fake pdf bytes"

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response):
        yield mock_response
