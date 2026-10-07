import './admin.css';
import { startAdmin } from './admin-app.js';

// Entry for /admin (admin.html, #196). Separate from the game: no canvas, no
// service worker registration, nothing from the game's screens.
const root = document.getElementById('admin');
if (root) startAdmin(root);
