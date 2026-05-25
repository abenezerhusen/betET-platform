import { apiRequest } from './client';

export interface PublicPromotion {
  id: string;
  title: string;
  description: string;
  type: 'bonus' | 'raffle' | 'tournament';
  image_url: string;
  terms: string;
  valid_to: string | null;
  cta_label: string;
  cta_url: string;
  is_claimed: boolean;
}

export function listActivePromotions() {
  return apiRequest<{ items: PublicPromotion[] }>('/api/promotions/active', {
    method: 'GET',
  });
}
