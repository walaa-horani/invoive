"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

const inputClass =
  "w-full rounded-xl border border-[#dce9ff] bg-[#f8f9ff] px-3.5 py-2.5 text-sm text-[#0b1c30] outline-none focus:border-[#0051d5] focus:ring-2 focus:ring-[#dbe1ff]";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signInAction, signingIn] = useActionState<AuthState, FormData>(signIn, {});
  const [signUpState, signUpAction, signingUp] = useActionState<AuthState, FormData>(signUp, {});
  const state = mode === "signin" ? signInState : signUpState;
  const pending = signingIn || signingUp;

  return (
    <form action={mode === "signin" ? signInAction : signUpAction} className="flex flex-col gap-4">
      <div>
        <h1 className="font-headline text-xl font-bold text-[#0b1c30]">
          {mode === "signin" ? "Sign in" : "Create your account"}
        </h1>
        <p className="text-sm text-[#45464d] mt-1">
          {mode === "signin" ? "Manage your workspace and billing." : "Start invoicing in minutes."}
        </p>
      </div>

      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-[#0b1c30]">
        Email
        <input name="email" type="email" autoComplete="email" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-[#0b1c30]">
        Password
        <input
          name="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={mode === "signup" ? 8 : undefined}
          required
          className={inputClass}
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-[#ba1a1a] bg-[#ffdad6]/50 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-[#005236] bg-[#85f8c4]/30 rounded-lg px-3 py-2">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-[#0051d5] hover:bg-[#003ea8] disabled:opacity-60 text-white font-semibold text-sm py-3 rounded-xl shadow-md transition-colors"
      >
        {pending ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="text-sm text-[#0051d5] hover:underline"
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
