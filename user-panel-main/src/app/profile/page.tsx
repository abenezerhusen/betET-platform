"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { Betslip } from "@/components/Betslip";
import {
  User,
  Phone,
  Lock,
  Save,
  CheckCircle2,
  AlertCircle,
  Users,
  Copy,
  Share2,
  Flame,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { profileApi, authApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Full name cannot be empty"),
});

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .regex(/[A-Z]/, "New password must contain uppercase letter")
      .regex(/[0-9]/, "New password must contain a number"),
    confirmPassword: z.string().min(1, "Confirm password is required"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  });

export default function ProfilePage() {
  const { user, isAuthenticated } = useAuth();
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [referralCode, setReferralCode] = useState("");
  const [referralStats, setReferralStats] = useState<{
    total: number;
    rewarded: number;
    bonus_earned: number;
  }>({ total: 0, rewarded: 0, bonus_earned: 0 });
  const [streak, setStreak] = useState<{
    current: number;
    longest: number;
    last_bet_date: string | null;
    bonus_earned: number;
  }>({ current: 0, longest: 0, last_bet_date: null, bonus_earned: 0 });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setLoading(true);
    profileApi
      .getProfile()
      .then((res) => {
        if (cancelled) return;
        const p = (res.profile ?? {}) as Record<string, unknown> & {
          metadata?: Record<string, unknown>;
          referral_code?: string;
          referral_stats?: { total: number; rewarded: number; bonus_earned: number };
          streak?: {
            current: number;
            longest: number;
            last_bet_date: string | null;
            bonus_earned: number;
          };
        };
        const meta = (p.metadata ?? {}) as Record<string, unknown>;
        const fn =
          (p.full_name as string | undefined) ??
          [meta.first_name, meta.last_name].filter(Boolean).join(" ") ??
          [p.first_name, p.last_name].filter(Boolean).join(" ");
        setFullName(fn || "");
        setPhone((p.phone as string | undefined) ?? user?.phone ?? "");
        if (p.referral_code) setReferralCode(p.referral_code);
        if (p.referral_stats) setReferralStats(p.referral_stats);
        if (p.streak) setStreak(p.streak);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "Failed to load profile");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.phone]);

  const copyReferralCode = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Failed to copy referral code to clipboard");
    }
  };

  const shareReferral = async () => {
    if (!referralCode) return;
    const text = `Join me on 1birr.bet! Use my referral code ${referralCode} when you sign up.`;
    if (typeof navigator !== "undefined" && (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share) {
      try {
        await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share({
          title: "1birr.bet referral",
          text,
        });
      } catch {
        /* user cancelled or browser blocked */
      }
    } else {
      await copyReferralCode();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const profileParsed = profileSchema.safeParse({ fullName });
    if (!profileParsed.success) {
      setError(profileParsed.error.issues[0]?.message ?? "Invalid profile input");
      return;
    }

    const wantsPasswordChange = Boolean(
      currentPassword || newPassword || confirmPassword
    );

    if (wantsPasswordChange) {
      const passwordParsed = passwordChangeSchema.safeParse({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      if (!passwordParsed.success) {
        setError(passwordParsed.error.issues[0]?.message ?? "Invalid password input");
        return;
      }
    }

    try {
      const [firstName = "", ...rest] = profileParsed.data.fullName.split(" ");
      await profileApi.updateProfile({
        metadata: {
          first_name: firstName,
          last_name: rest.join(" "),
        },
      });

      if (wantsPasswordChange) {
        await authApi.changePassword({
          current_password: currentPassword,
          new_password: newPassword,
        });
      }
    } catch (err) {
      setError((err as Error)?.message || "Failed to update profile");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSuccess(
      wantsPasswordChange
        ? "Profile and password updated successfully"
        : "Profile updated successfully"
    );
  };

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <div
        className="flex-1 p-4 sm:p-8"
        style={{ background: "var(--mezzo-bg-primary)" }}
      >
        <h1 className="text-2xl font-bold mb-6">My Profile</h1>
        {loading && <p className="text-sm text-gray-400 mb-4">Loading profile...</p>}

        <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-4 py-2 rounded bg-red-500/15 border border-red-500/40 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 px-4 py-2 rounded bg-green-500/15 border border-green-500/40 text-green-400 text-sm">
              <CheckCircle2 className="w-4 h-4" />
              {success}
            </div>
          )}

          <div
            className="p-6 rounded-lg space-y-4"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            <h3 className="font-bold">Account Information</h3>

            <div>
              <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
                <User className="w-4 h-4" />
                Full Name
              </label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2 flex items-center gap-2">
                <Phone className="w-4 h-4" />
                Phone Number
              </label>
              <Input
                value={phone}
                readOnly
                className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-gray-300 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">
                Phone number is locked for security.
              </p>
            </div>
          </div>

          <div
            className="p-6 rounded-lg space-y-4"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            <h3 className="font-bold flex items-center gap-2">
              <Users className="w-4 h-4" />
              My Referral Code
            </h3>
            <p className="text-xs text-gray-500 -mt-2">
              Share this code with friends — when they register and make their
              first qualifying deposit you earn a referral bonus.
            </p>

            <div className="flex items-stretch gap-2">
              <Input
                value={referralCode}
                readOnly
                placeholder={loading ? "Loading…" : "—"}
                className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white font-mono tracking-wider"
              />
              <Button
                type="button"
                onClick={copyReferralCode}
                disabled={!referralCode}
                title="Copy code"
                className="flex items-center gap-1"
              >
                <Copy className="w-4 h-4" />
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                type="button"
                onClick={shareReferral}
                disabled={!referralCode}
                title="Share"
                className="flex items-center gap-1"
              >
                <Share2 className="w-4 h-4" />
                Share
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="rounded-md p-3 bg-[var(--mezzo-bg-tertiary)]">
                <div className="text-xs text-gray-400">Friends Referred</div>
                <div className="text-lg font-semibold">{referralStats.total}</div>
              </div>
              <div className="rounded-md p-3 bg-[var(--mezzo-bg-tertiary)]">
                <div className="text-xs text-gray-400">Rewarded</div>
                <div className="text-lg font-semibold">{referralStats.rewarded}</div>
              </div>
              <div className="rounded-md p-3 bg-[var(--mezzo-bg-tertiary)]">
                <div className="text-xs text-gray-400">Bonus Earned</div>
                <div className="text-lg font-semibold">
                  ETB {referralStats.bonus_earned.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div
            className="p-6 rounded-lg space-y-4"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            <h3 className="font-bold flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-400" />
              Betting Streak
            </h3>
            <p className="text-xs text-gray-500 -mt-2">
              Place a qualifying bet every day to grow your streak — milestone
              rewards are credited automatically.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-md p-3 bg-[var(--mezzo-bg-tertiary)]">
                <div className="text-xs text-gray-400">Current Streak</div>
                <div className="text-lg font-semibold">
                  {streak.current} {streak.current === 1 ? "day" : "days"}
                </div>
              </div>
              <div className="rounded-md p-3 bg-[var(--mezzo-bg-tertiary)]">
                <div className="text-xs text-gray-400">Longest Streak</div>
                <div className="text-lg font-semibold">
                  {streak.longest} {streak.longest === 1 ? "day" : "days"}
                </div>
              </div>
              <div className="rounded-md p-3 bg-[var(--mezzo-bg-tertiary)]">
                <div className="text-xs text-gray-400">Last Bet</div>
                <div className="text-lg font-semibold">
                  {streak.last_bet_date ?? "—"}
                </div>
              </div>
              <div className="rounded-md p-3 bg-[var(--mezzo-bg-tertiary)]">
                <div className="text-xs text-gray-400">Streak Rewards</div>
                <div className="text-lg font-semibold">
                  ETB {streak.bonus_earned.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div
            className="p-6 rounded-lg space-y-4"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            <h3 className="font-bold flex items-center gap-2">
              <Lock className="w-4 h-4" />
              Change Password
            </h3>
            <p className="text-xs text-gray-500 -mt-2">
              Leave these fields blank if you don’t want to change your password.
            </p>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Current Password
              </label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                New Password
              </label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Confirm New Password
              </label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
              />
            </div>
          </div>

          <Button
            type="submit"
            className="text-black font-semibold px-8 flex items-center gap-2"
            style={{ background: "var(--mezzo-accent-green)" }}
          >
            <Save className="w-4 h-4" />
            Save Changes
          </Button>
        </form>
      </div>

      <Betslip />
    </div>
  );
}
