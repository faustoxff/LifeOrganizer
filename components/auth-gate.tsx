"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { LoginForm } from "@/components/login-form";

type AuthContextValue = {
  user: NonNullable<ReturnType<typeof useUser>["user"]>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthGate");
  return ctx;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <span className="milo-loader">
          <span className="milo-loader-bar" />
          <span className="milo-loader-bar" />
          <span className="milo-loader-bar" />
          <span className="milo-loader-bar" />
          <span className="milo-loader-bar" />
        </span>
      </div>
    );
  }

  if (!isSignedIn || !user) {
    return <LoginForm />;
  }

  return (
    <AuthContext.Provider value={{ user, logout: () => signOut() }}>
      {children}
    </AuthContext.Provider>
  );
}
