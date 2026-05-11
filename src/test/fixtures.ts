import type { Activity } from '../data/types';

const STORAGE_KEY = 'fogandfrontier.activities.v1';

export function seedActivities(list: Activity[]): void {
  const store = Object.fromEntries(list.map((a) => [a.id, a]));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export const muirWoods: Activity = {
  id: 'test-muir',
  name: 'Test Muir Woods',
  shortDescription: 'Short redwoods description.',
  longDescription: 'A longer description of the redwoods loop.',
  category: 'hiking',
  region: 'north-bay',
  location: {
    city: 'Mill Valley, CA',
    coords: { lat: 37.8917, lng: -122.5719 },
  },
  duration: 'Half Day',
  difficulty: 'moderate',
  dogFriendly: false,
  coverImage: 'https://example.com/muir.jpg',
};

export const completedHike: Activity = {
  id: 'test-completed',
  name: 'Test Completed Hike',
  shortDescription: 'A trip we already took.',
  category: 'scenic',
  region: 'north-bay',
  location: {
    city: 'Mill Valley, CA',
    coords: { lat: 37.9295, lng: -122.5807 },
  },
  duration: '2-3 Hours',
  difficulty: 'easy',
  dogFriendly: true,
  coverImage: 'https://example.com/tam.jpg',
  completed: true,
  completedDate: '2025-11-02',
  notes: 'Beautiful sunset.',
};

export const dogFriendlyTidepools: Activity = {
  id: 'test-tide',
  name: 'Test Tide Pools',
  shortDescription: 'Tide pools at low tide.',
  category: 'scenic',
  region: 'peninsula',
  location: {
    city: 'Moss Beach, CA',
    coords: { lat: 37.5235, lng: -122.5172 },
  },
  duration: '1-2 Hours',
  difficulty: 'easy',
  dogFriendly: true,
  coverImage: 'https://example.com/tide.jpg',
};
