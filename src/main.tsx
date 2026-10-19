import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/vt323/400.css';
import './theme.css';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('BOX BOX!: #root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
