import './style.css';

// ?v=tap opens the first tap-the-buttons build, ?v=toss1 the first toss toy.
// Everything else gets the shift: fryer station plus freezer and pass microgames.
const version = new URLSearchParams(location.search).get('v');
if (version === 'tap') void import('./tap-main');
else if (version === 'toss1') void import('./toss/main');
else void import('./shift/main');
