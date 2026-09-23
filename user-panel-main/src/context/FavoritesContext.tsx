"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface FavoritesContextType {
  favoriteMatches: string[];
  favoriteTeams: string[];
  toggleFavoriteMatch: (matchId: string) => void;
  toggleFavoriteTeam: (team: string) => void;
  isFavoriteMatch: (matchId: string) => boolean;
  isFavoriteTeam: (team: string) => boolean;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

/**
 * Safely read a persisted string[] from localStorage.
 *
 * Previously we called `JSON.parse(localStorage.getItem(...))` unguarded. If
 * that key ever held a corrupt / non-JSON / wrong-shaped value (interrupted
 * write, storage eviction, an older app version, a browser extension, etc.),
 * the parse threw inside the mount effect. Because this provider wraps the
 * whole app and there was no error boundary, that single throw crashed the
 * entire client with Next.js's generic "Application error" screen — and since
 * the bad value stayed in localStorage, it re-threw on every reload, so the
 * crash appeared permanent. We now parse defensively, validate the shape, and
 * self-heal by dropping the corrupt value. Behaviour is unchanged for valid data.
 */
function readStringArray(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string');
    }
    // Wrong shape — treat as empty and clear the bad value.
    window.localStorage.removeItem(key);
    return [];
  } catch {
    // Corrupt / non-JSON — drop it so it can never brick the app again.
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return [];
  }
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favoriteMatches, setFavoriteMatches] = useState<string[]>([]);
  const [favoriteTeams, setFavoriteTeams] = useState<string[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    setFavoriteMatches(readStringArray('mezzo_favorite_matches'));
    setFavoriteTeams(readStringArray('mezzo_favorite_teams'));
  }, []);

  // Save to localStorage whenever favorites change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('mezzo_favorite_matches', JSON.stringify(favoriteMatches));
    }
  }, [favoriteMatches]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('mezzo_favorite_teams', JSON.stringify(favoriteTeams));
    }
  }, [favoriteTeams]);

  const toggleFavoriteMatch = (matchId: string) => {
    setFavoriteMatches(prev =>
      prev.includes(matchId)
        ? prev.filter(id => id !== matchId)
        : [...prev, matchId]
    );
  };

  const toggleFavoriteTeam = (team: string) => {
    setFavoriteTeams(prev =>
      prev.includes(team)
        ? prev.filter(t => t !== team)
        : [...prev, team]
    );
  };

  const isFavoriteMatch = (matchId: string) => {
    return favoriteMatches.includes(matchId);
  };

  const isFavoriteTeam = (team: string) => {
    return favoriteTeams.includes(team);
  };

  return (
    <FavoritesContext.Provider value={{
      favoriteMatches,
      favoriteTeams,
      toggleFavoriteMatch,
      toggleFavoriteTeam,
      isFavoriteMatch,
      isFavoriteTeam
    }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error("useFavorites must be used within FavoritesProvider");
  }
  return context;
}
