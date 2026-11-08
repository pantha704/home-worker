import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPanel } from "@/components/auth-panel";
import { getSupabaseClient } from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const signInWithOtp = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  signInWithPassword.mockResolvedValue({ error: null });
  signUp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
  signInWithOtp.mockResolvedValue({ error: null });
  vi.mocked(getSupabaseClient).mockReturnValue({
    auth: { signInWithPassword, signUp, signInWithOtp },
  } as never);
});

async function fillAndSubmit(password = "correct-horse") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email address/i), "learner@example.com");
  await user.type(screen.getByLabelText(/^password$/i), password);
  await user.click(screen.getByRole("button", { name: /^sign in$/i }));
  return user;
}

describe("AuthPanel", () => {
  it("signs in with a password without sending any email", async () => {
    render(<AuthPanel />);
    await fillAndSubmit();
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "learner@example.com", password: "correct-horse" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("creates an account from the sign-up mode", async () => {
    render(<AuthPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/email address/i), "learner@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "correct-horse");
    await user.click(screen.getByRole("button", { name: /^create account$/i }));
    expect(signUp).toHaveBeenCalledWith({ email: "learner@example.com", password: "correct-horse" });
    expect(await screen.findByRole("status")).toHaveTextContent(/account created/i);
  });

  it("rejects a password shorter than the minimum before calling the service", async () => {
    render(<AuthPanel />);
    await fillAndSubmit("short");
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(/at least 8 characters/i);
  });

  it("surfaces the wrong-credentials case in plain language", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<AuthPanel />);
    await fillAndSubmit();
    expect(await screen.findByRole("status")).toHaveTextContent(/wrong email or password/i);
  });

  it("keeps the emailed-link path available", async () => {
    render(<AuthPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /email me a link instead/i }));
    await user.type(screen.getByLabelText(/email address/i), "learner@example.com");
    await user.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "learner@example.com",
      options: { emailRedirectTo: window.location.origin },
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
