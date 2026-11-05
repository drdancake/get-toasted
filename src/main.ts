import './style.css';

// ?v=tap opens the first tap-the-buttons build, kept for comparison.
// Everything else gets the toss prototype.
const version = new URLSearchParams(location.search).get('v');
if (version === 'tap') void import('./tap-main');
else void import('./toss/main');
