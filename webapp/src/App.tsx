import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import AuthGate from "@/components/AuthGate";
import Layout from "@/components/Layout";
import Library from "@/pages/Library";
import People from "@/pages/People";
import PersonDetail from "@/pages/PersonDetail";
import ItemDetail from "@/pages/ItemDetail";
import Search from "@/pages/Search";
import Review from "@/pages/Review";
import Collections from "@/pages/Collections";

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <AnimatePresence mode="wait">
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Library status="to_read" />} />
              <Route path="/read" element={<Library status="read" />} />
              <Route path="/writings" element={<Library type="writing" />} />
              <Route path="/people" element={<People />} />
              <Route path="/people/:id" element={<PersonDetail />} />
              <Route path="/item/:id" element={<ItemDetail />} />
              <Route path="/search" element={<Search />} />
              <Route path="/review" element={<Review />} />
              <Route path="/collections" element={<Collections />} />
            </Route>
          </Routes>
        </AnimatePresence>
      </AuthGate>
    </BrowserRouter>
  );
}
