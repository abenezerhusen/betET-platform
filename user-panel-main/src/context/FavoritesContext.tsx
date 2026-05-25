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

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favoriteMatches, setFavoriteMatches] = useState<string[]>([]);
  const [favoriteTeams, setFavoriteTeams] = useState<string[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMatches = localStorage.getItem('mezzo_favorite_matches');
      const savedTeams = localStorage.getItem('mezzo_favorite_teams');

      if (savedMatches) {
        setFavoriteMatches(JSON.parse(savedMatches));
      }
      if (savedTeams) {
        setFavoriteTeams(JSON.parse(savedTeams));
      }
    }
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
