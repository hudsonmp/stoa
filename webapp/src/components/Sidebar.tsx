import { NavLink } from "react-router-dom";
import {
  BookOpen,
  BookCheck,
  FolderOpen,
  FileText,
  Search,
  LogOut,
  UserCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface SidebarProps {
  counts: {
    to_read: number;
    read: number;
    writing: number;
    total: number;
  };
  reviewDue?: number;
}

const navItems = [
  { to: "/", label: "To Read", icon: BookOpen, countKey: "to_read" as const },
  { to: "/read", label: "Read", icon: BookCheck, countKey: "read" as const },
];

const secondaryItems = [
  { to: "/papers", label: "Papers", icon: FileText },
  { to: "/authors", label: "Authors", icon: UserCheck },
  { to: "/collections", label: "Collections", icon: FolderOpen },
];

export default function Sidebar({ counts, reviewDue = 0 }: SidebarProps) {
  const { signOut } = useAuth();

  return (
    <aside
      className="w-[240px] flex-shrink-0 bg-bg-sidebar border-r border-border
                 flex flex-col h-screen select-none"
    >
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <h1 className="font-serif text-lg font-semibold text-text-primary tracking-tight">
          Library
        </h1>
        <p className="text-[11px] text-text-tertiary mt-1 font-sans">
          Use tags like{" "}
          <span className="font-mono text-text-secondary">#book</span>{" "}
          <span className="font-mono text-text-secondary">#reading</span>
        </p>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 px-3 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon, countKey }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `flex items-center justify-between px-3 py-2 rounded-card text-sm
               transition-warm group
               ${
                 isActive
                   ? "bg-bg-secondary text-text-primary border-l-2 border-accent ml-0 pl-[10px]"
                   : "text-text-secondary hover:bg-bg-secondary/60 hover:text-text-primary"
               }`
            }
          >
            <span className="flex items-center gap-2.5">
              <Icon
                size={16}
                className="text-text-tertiary group-hover:text-text-secondary transition-warm"
              />
              {label}
            </span>
            {countKey && counts[countKey] > 0 && (
              <span className="text-[11px] font-mono text-text-tertiary tabular-nums">
                {counts[countKey]}
              </span>
            )}
          </NavLink>
        ))}

        {/* Divider */}
        <div className="h-px bg-border my-3 mx-2" />

        {secondaryItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-card text-sm
               transition-warm group
               ${
                 isActive
                   ? "bg-bg-secondary text-text-primary border-l-2 border-accent ml-0 pl-[10px]"
                   : "text-text-secondary hover:bg-bg-secondary/60 hover:text-text-primary"
               }`
            }
          >
            <Icon
              size={16}
              className="text-text-tertiary group-hover:text-text-secondary transition-warm"
            />
            {label}
          </NavLink>
        ))}

        {/* Divider */}
        <div className="h-px bg-border my-3 mx-2" />

        <NavLink
          to="/search"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-card text-sm
             transition-warm group
             ${
               isActive
                 ? "bg-bg-secondary text-text-primary border-l-2 border-accent ml-0 pl-[10px]"
                 : "text-text-secondary hover:bg-bg-secondary/60 hover:text-text-primary"
             }`
          }
        >
          <Search
            size={16}
            className="text-text-tertiary group-hover:text-text-secondary transition-warm"
          />
          Search
        </NavLink>

      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-border flex items-center justify-between">
        <p className="text-[10px] font-mono text-text-tertiary tracking-wider uppercase pl-2">
          Stoa
        </p>
        <button
          onClick={signOut}
          className="p-1.5 rounded-card hover:bg-bg-secondary transition-warm group"
          title="Sign out"
        >
          <LogOut
            size={13}
            className="text-text-tertiary group-hover:text-text-secondary transition-warm"
          />
        </button>
      </div>
    </aside>
  );
}
