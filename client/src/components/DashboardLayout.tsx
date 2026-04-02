import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { 
  ShieldCheck, 
  LayoutDashboard, 
  LogOut, 
  Menu,
  PlusCircle,
  Activity,
  Settings
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

interface DashboardLayoutProps {
  children: React.ReactNode;
  contentWidthClass?: string;
}

import AnimatedAuthBackground from './AnimatedAuthBackground';
import './DashboardLayout.css';
import { showDashboardToast } from "@/lib/ui-toast";

export function DashboardLayout({ children, contentWidthClass = "max-w-5xl" }: DashboardLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const isAdmin = user?.isAdmin || user?.role === "admin";
  const navItems = [
    { href: "/user/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "instagram", label: "New Analysis", icon: PlusCircle, action: "instagram" },
    { href: "/history", label: "History", icon: Activity },
    ...(isAdmin ? [{ href: "/admin", label: "Admin Panel", icon: Settings }] : []),
  ];

  const handleNewAnalysis = () => {
    showDashboardToast({
      title: "Open Instagram",
      description: "Use the browser extension on Instagram to run a new analysis.",
      variant: "info",
    });
    window.open("https://www.instagram.com/direct/inbox/", "_blank", "noopener,noreferrer");
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="dashboard-layout min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col md:flex-row">
      <div className="dashboard-bg fixed top-0 left-0 w-full h-full z-[-1]">
        <AnimatedAuthBackground />
      </div>
      {/* Sidebar - Desktop */}
      <aside className="dashboard-sidebar hidden md:flex flex-col w-64 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-r border-slate-200 dark:border-slate-800 h-screen sticky top-0">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
          <Link to="/user/dashboard" className="dashboard-brand flex items-center gap-2 text-primary font-bold text-xl">
            <ShieldCheck className="h-8 w-8" />
            <span>Instagram Authentication</span>
          </Link>
        </div>
        
        <div className="p-4 flex-1">
          <nav className="dashboard-nav space-y-1">
            {navItems.map((item) => {
              if (item.action === "instagram") {
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={handleNewAnalysis}
                    className="dashboard-nav-link flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </button>
                );
              }
              return (
                <Link 
                  key={item.href} 
                  to={item.href}
                  className={`
                    dashboard-nav-link flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200
                    ${isActive(item.href) 
                      ? "is-active bg-primary text-primary-foreground shadow-lg shadow-primary/25" 
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }
                  `}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800">
          <div className="dashboard-user flex items-center gap-3 px-4 py-3 mb-2">
            <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
               <div className="h-full w-full flex items-center justify-center text-xs font-bold text-slate-500">
                 {user?.username?.[0].toUpperCase() || "U"}
               </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold truncate">{user?.username || "User"}</p>
                {isAdmin && <Badge variant="secondary" className="text-xs">Admin</Badge>}
              </div>
              <p className="text-xs text-muted-foreground truncate">{user?.role}</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="dashboard-signout w-full justify-start text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            onClick={() => logout()}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="dashboard-mobile md:hidden flex items-center justify-between p-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50">
        <Link to="/user/dashboard" className="dashboard-brand flex items-center gap-2 text-primary font-bold text-lg">
          <ShieldCheck className="h-6 w-6" />
          <span>Instagram Authentication</span>
        </Link>
        <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="dashboard-sidebar w-64 p-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm">
             <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <Link to="/user/dashboard" className="dashboard-brand flex items-center gap-2 text-primary font-bold text-xl" onClick={() => setIsMobileOpen(false)}>
                <ShieldCheck className="h-8 w-8" />
                <span>Instagram Authentication</span>
              </Link>
            </div>
            <nav className="dashboard-nav p-4 space-y-1">
              {navItems.map((item) => {
                if (item.action === "instagram") {
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => {
                        handleNewAnalysis();
                        setIsMobileOpen(false);
                      }}
                      className="dashboard-nav-link flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 w-full"
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </button>
                  );
                }
                return (
                  <Link 
                    key={item.href} 
                    to={item.href}
                    onClick={() => setIsMobileOpen(false)}
                    className={`
                      dashboard-nav-link flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200
                      ${isActive(item.href) 
                        ? "is-active bg-primary text-primary-foreground shadow-lg shadow-primary/25" 
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }
                    `}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
               <Button 
                variant="ghost" 
                className="dashboard-signout w-full justify-start text-rose-600 hover:text-rose-700 hover:bg-rose-50 mt-8"
                onClick={() => logout()}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </Button>
            </nav>
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="dashboard-main flex-1 p-4 md:p-8 overflow-y-auto">
        <div className={`${contentWidthClass} mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500`}>
          {children}
        </div>
      </main>
    </div>
  );
}

