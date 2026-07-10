import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/map/map-page').then((m) => m.MapPage),
    title: 'Marsad — The Observatory of the World',
  },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about-page').then((m) => m.AboutPage),
    title: 'The Story of Marsad',
  },
  { path: '**', redirectTo: '' },
];
