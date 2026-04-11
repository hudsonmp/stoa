import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import AuthGate from "@/components/AuthGate";
import Layout from "@/components/Layout";
import Library from "@/pages/Library";
import People from "@/pages/People";
import PersonDetail from "@/pages/PersonDetail";
import ItemDetail from "@/pages/ItemDetail";
import Reader from "@/pages/Reader";
import Reading from "@/pages/Reading";
import Search from "@/pages/Search";
import Review from "@/pages/Review";
import Collections from "@/pages/Collections";
import Papers from "@/pages/Papers";
import Authors from "@/pages/Authors";
import Notes from "@/pages/Notes";
import Writings from "@/pages/Writings";
import Friends from "@/pages/Friends";
import Profile from "@/pages/Profile";
import PublicItem from "@/pages/PublicItem";

// AuthGate as a layout route: anything under this branch is gated behind
// auth; /share/:token is a sibling and bypasses it entirely, so anonymous
// readers of public share links are never bounced to the sign-in screen.
function AuthedBranch() {
  return (
    <AuthGate>
      <Outlet />
    </AuthGate>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AnimatePresence mode="wait">
        <Routes>
          {/* Public — no auth. Token possession is the access credential. */}
          <Route path="/share/:token" element={<PublicItem />} />

          {/* Everything else is gated behind auth. */}
          <Route element={<AuthedBranch />}>
            <Route element={<Layout />}>
              <Route index element={<Library status="to_read" />} />
              <Route path="/read" element={<Library status="read" />} />
              <Route path="/writings" element={<Writings />} />
              <Route path="/writings/:id" element={<Writings />} />
              <Route path="/people" element={<People />} />
              <Route path="/people/:id" element={<PersonDetail />} />
              <Route path="/item/:id" element={<ItemDetail />} />
              <Route path="/reader/:id" element={<Reader />} />
              <Route path="/reading" element={<Reading />} />
              <Route path="/search" element={<Search />} />
              <Route path="/review" element={<Review />} />
              <Route path="/papers" element={<Papers />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/notes/:id" element={<Notes />} />
              <Route path="/authors" element={<Authors />} />
              <Route path="/collections" element={<Collections />} />
              <Route path="/friends" element={<Friends />} />
              <Route path="/@:username" element={<Profile />} />
            </Route>
          </Route>
        </Routes>
      </AnimatePresence>
    </BrowserRouter>
  );
}
