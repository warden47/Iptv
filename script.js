// ====================== GLOBALS ======================
const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/index.m3u';
// List of CORS proxies to try (in order)
const PROXY_URLS = [
  'https://corsproxy.io/?',                         // very reliable
  'https://api.allorigins.win/raw?url=',
  'https://cors-anywhere.herokuapp.com/',
];

let allChannels = [];
let filteredChannels = [];
let currentPage = 1;
const pageSize = 30;
let activeCategory = '';
let pingStatusMap = new Map();

// ====================== DOM elements ======================
const statusText = document.getElementById('statusText');
const homeView = document.getElementById('homeView');
const browseView = document.getElementById('browseView');
const categoryRows = document.getElementById('categoryRows');
const channelGrid = document.getElementById('channelGrid');
const paginationDiv = document.getElementById('pagination');
const searchBox = document.getElementById('searchBox');
const categoryPills = document.getElementById('categoryPills');
const playerModal = document.getElementById('playerModal');
const videoPlayer = document.getElementById('videoPlayer');
const aboutModal = document.getElementById('aboutModal');

// ====================== UI Helpers ======================
function setStatus(msg, isError = false) {
  statusText.textContent = msg;
  statusText.style.color = isError ? '#fca5a5' : '#f1f5f9';
}

// Sidebar / Navigation
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
document.getElementById('hamburgerBtn').addEventListener('click', () => {
  sidebar.classList.add('open');
  overlay.classList.add('show');
});
document.getElementById('closeSidebar').addEventListener('click', closeSidebar);
overlay.addEventListener('click', closeSidebar);
function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.remove('show');
}

document.querySelector('.nav-home').addEventListener('click', (e) => {
  e.preventDefault();
  switchView('home');
  closeSidebar();
});
document.querySelector('.nav-browse').addEventListener('click', (e) => {
  e.preventDefault();
  switchView('browse');
  closeSidebar();
});
document.querySelector('.nav-about').addEventListener('click', (e) => {
  e.preventDefault();
  aboutModal.classList.add('active');
  closeSidebar();
});
document.getElementById('closeAbout').addEventListener('click', () => {
  aboutModal.classList.remove('active');
});

function switchView(view) {
  homeView.classList.toggle('active', view === 'home');
  browseView.classList.toggle('active', view === 'browse');
  if (view === 'browse') renderBrowseView();
}

// Player modal
document.getElementById('closePlayer').addEventListener('click', closePlayer);
function closePlayer() {
  playerModal.classList.remove('active');
  if (window.hls) {
    window.hls.destroy();
    window.hls = null;
  }
  videoPlayer.pause();
  videoPlayer.removeAttribute('src');
  videoPlayer.load();
}

function playStream(url) {
  playerModal.classList.add('active');
  if (Hls.isSupported()) {
    if (window.hls) window.hls.destroy();
    const hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(videoPlayer);
    hls.on(Hls.Events.MANIFEST_PARSED, () => videoPlayer.play());
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
          case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
          default: hls.destroy(); break;
        }
      }
    });
    window.hls = hls;
  } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
    videoPlayer.src = url;
    videoPlayer.play();
  } else {
    alert('Your browser does not support HLS playback.');
  }
}

// ====================== M3U Parser ======================
function parseM3U(text) {
  const lines = text.split('\n');
  const channels = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF')) {
      if (current) channels.push(current);
      const info = trimmed.substring(8);
      const commaIndex = info.indexOf(',');
      let meta = '', name = '';
      if (commaIndex >= 0) {
        meta = info.substring(0, commaIndex).trim();
        name = info.substring(commaIndex + 1).trim();
      } else {
        name = info.trim();
      }
      const getAttr = (attr) => {
        const m = meta.match(new RegExp(`${attr}="([^"]*)"`));
        return m ? m[1] : '';
      };
      current = {
        displayName: name,
        tvgId: getAttr('tvg-id'),
        tvgName: getAttr('tvg-name'),
        tvgLogo: getAttr('tvg-logo'),
        groupTitle: getAttr('group-title'),
      };
    } else if (trimmed && !trimmed.startsWith('#') && current) {
      current.url = trimmed;
      channels.push(current);
      current = null;
    }
  }
  if (current) channels.push(current);
  return channels;
}

// ====================== Data Fetch with Fallback ======================
async function fetchPlaylistText() {
  // Try direct first
  try {
    setStatus('Fetching playlist directly...');
    const resp = await fetch(PLAYLIST_URL);
    if (resp.ok) {
      setStatus('Playlist loaded directly.');
      return await resp.text();
    }
  } catch (e) {
    console.log('Direct fetch failed:', e.message);
  }

  // Try each proxy in order
  for (const proxy of PROXY_URLS) {
    try {
      setStatus(`Trying proxy: ${proxy}...`);
      const resp = await fetch(proxy + encodeURIComponent(PLAYLIST_URL));
      if (resp.ok) {
        setStatus('Playlist loaded via proxy.');
        return await resp.text();
      }
    } catch (e) {
      console.log(`Proxy ${proxy} failed:`, e.message);
    }
  }

  throw new Error('All fetch methods failed. Check your internet or try later.');
}

// ====================== Category mapping ======================
const CATEGORY_MAP = {
  'Sports': ['sports', 'sport'],
  'Movies': ['movies', 'movie', 'film'],
  'Kids': ['kids', 'child', 'children', 'cartoon'],
  'Music': ['music', 'musical'],
  'News': ['news', 'information'],
  'Documentary': ['documentary', 'docu'],
  'Religion': ['religion', 'religious', 'faith'],
};

function getChannelsByCategory(cat) {
  const keys = CATEGORY_MAP[cat] || [cat.toLowerCase()];
  return allChannels.filter(ch => {
    const group = (ch.groupTitle || '').toLowerCase();
    return keys.some(k => group.includes(k));
  });
}

// ====================== Channel Card Builder ======================
function createChannelCard(channel) {
  const card = document.createElement('div');
  card.className = 'channel-card';
  card.innerHTML = `
    <img class="card-img" src="${channel.tvgLogo || 'https://via.placeholder.com/200x120/1e3a8a/ffffff?text=TV'}" 
         onerror="this.src='https://via.placeholder.com/200x120/1e3a8a/ffffff?text=TV'">
    <div class="card-body">
      <div class="card-name">${channel.displayName || 'Unknown'}</div>
      <div class="card-meta">
        <span class="ping-status" id="ping-${btoa(channel.url)}"></span>
        <button class="ping-btn" data-url="${channel.url}"><i class="fas fa-sync-alt"></i> Ping</button>
      </div>
    </div>
  `;
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.ping-btn')) {
      playStream(channel.url);
    }
  });
  card.querySelector('.ping-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    pingChannel(channel.url, card.querySelector('.ping-status'));
  });
  return card;
}

// ====================== Ping Logic ======================
async function pingChannel(url, statusEl) {
  if (pingStatusMap.has(url) && !pingStatusMap.get(url).checking) {
    updatePingUI(statusEl, pingStatusMap.get(url).status);
    return;
  }
  pingStatusMap.set(url, { checking: true, status: null });
  statusEl.innerHTML = '<i class="fas fa-spinner fa-pulse"></i>';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    // Try a simple HEAD request through a proxy
    const resp = await fetch('https://corsproxy.io/?' + encodeURIComponent(url), {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const available = resp.ok;
    pingStatusMap.set(url, { checking: false, status: available ? 'available' : 'unavailable' });
    updatePingUI(statusEl, available ? 'available' : 'unavailable');
  } catch (e) {
    pingStatusMap.set(url, { checking: false, status: 'unavailable' });
    updatePingUI(statusEl, 'unavailable');
  }
}

function updatePingUI(el, status) {
  if (status === 'available') {
    el.innerHTML = '<span class="status-available"><i class="fas fa-circle"></i> Available</span>';
  } else {
    el.innerHTML = '<span class="status-unavailable"><i class="fas fa-circle"></i> Unavailable</span>';
  }
}

// ====================== Home Rows ======================
function buildHomeRows() {
  categoryRows.innerHTML = '';
  const orderedCats = ['Sports','Movies','Kids','Music','News','Documentary','Religion'];
  orderedCats.forEach(cat => {
    const chs = getChannelsByCategory(cat);
    if (chs.length === 0) return;
    const section = document.createElement('div');
    section.className = 'category-section';
    section.innerHTML = `<div class="category-title"><i class="fas fa-tv"></i> ${cat}</div>`;
    const row = document.createElement('div');
    row.className = 'scroll-row';
    chs.slice(0, 30).forEach(ch => row.appendChild(createChannelCard(ch)));
    section.appendChild(row);
    categoryRows.appendChild(section);
  });
}

// ====================== Browse Filters ======================
function setupBrowseFilters() {
  categoryPills.innerHTML = '';
  const allPill = document.createElement('button');
  allPill.className = 'pill active';
  allPill.textContent = 'All';
  allPill.addEventListener('click', () => {
    activeCategory = '';
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    allPill.classList.add('active');
    currentPage = 1;
    applyBrowseFilters();
  });
  categoryPills.appendChild(allPill);
  ['Sports','Movies','Kids','Music','News','Documentary','Religion'].forEach(cat => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.textContent = cat;
    pill.addEventListener('click', () => {
      activeCategory = cat;
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentPage = 1;
      applyBrowseFilters();
    });
    categoryPills.appendChild(pill);
  });
  searchBox.addEventListener('input', () => {
    currentPage = 1;
    applyBrowseFilters();
  });
}

function applyBrowseFilters() {
  const search = searchBox.value.toLowerCase();
  filteredChannels = allChannels.filter(ch => {
    if (search && !ch.displayName.toLowerCase().includes(search)) return false;
    if (activeCategory) {
      const keys = CATEGORY_MAP[activeCategory] || [activeCategory.toLowerCase()];
      const group = (ch.groupTitle || '').toLowerCase();
      if (!keys.some(k => group.includes(k))) return false;
    }
    return true;
  });
  renderBrowseView();
}

function renderBrowseView() {
  if (!browseView.classList.contains('active')) return;
  const totalPages = Math.ceil(filteredChannels.length / pageSize);
  if (currentPage > totalPages) currentPage = totalPages || 1;
  const start = (currentPage - 1) * pageSize;
  const pageChannels = filteredChannels.slice(start, start + pageSize);
  channelGrid.innerHTML = '';
  pageChannels.forEach(ch => channelGrid.appendChild(createChannelCard(ch)));
  paginationDiv.innerHTML = '';
  if (totalPages > 1) {
    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'Previous';
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderBrowseView(); } });
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; renderBrowseView(); } });
    const info = document.createElement('span');
    info.textContent = `Page ${currentPage} of ${totalPages}`;
    paginationDiv.appendChild(prevBtn);
    paginationDiv.appendChild(info);
    paginationDiv.appendChild(nextBtn);
  }
}

// ====================== Initialization ======================
async function init() {
  try {
    const text = await fetchPlaylistText();
    allChannels = parseM3U(text);
    setStatus(`Loaded ${allChannels.length} channels.`);
    buildHomeRows();
    setupBrowseFilters();
  } catch (err) {
    setStatus('Error: ' + err.message, true);
    // Show fallback message on screen
    categoryRows.innerHTML = `<div style="padding:2rem; text-align:center;">
      <h3>Oops! Could not load channels.</h3>
      <p>Please check your network connection or try again later.</p>
      <p>If you're the site owner, ensure the playlist URL is correct and that CORS proxies are working.</p>
    </div>`;
  }
}

init();