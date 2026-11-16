// Standalone entry of the component gallery (gallery.html), independent of the app shell.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import Gallery from './Gallery';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
