import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";
import { clearAuthToken, getAuthToken } from "@/lib/token-store";

interface User {
  id?: number;
  role?: string;
  username?: string;
  isAdmin?: boolean;
}

interface TokenPayload {
  id?: number;
  userId?: number;
  username?: string;
  accountType?: string;
  account_type?: string;
  role?: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      try {
        const decoded = jwtDecode<TokenPayload>(token);
        const normalizedRole = String(
          decoded.accountType ?? decoded.account_type ?? decoded.role ?? "user"
        ).toLowerCase();
        setUser({
          id: decoded.userId ?? decoded.id,
          username: decoded.username,
          role: normalizedRole,
          isAdmin: normalizedRole === "admin",
        });
      } catch (error) {
        console.error("Invalid token");
        clearAuthToken();
        navigate("/login");
      }
    }
    setIsLoading(false);
  }, [navigate]);

  const logout = () => {
    clearAuthToken();
    setUser(null);
    navigate("/login");
  };

  return { user, isLoading, logout };
}
