// Header scroll effect with throttling to prevent shaking
let ticking = false;

function updateHeader() {
  const header = document.querySelector('header');

  if (window.scrollY > 50) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }

  ticking = false;
}

function requestTick() {
  if (!ticking) {
    requestAnimationFrame(updateHeader);
    ticking = true;
  }
}

window.addEventListener('scroll', requestTick, { passive: true });

// Mobile navigation toggle
document.addEventListener('DOMContentLoaded', function() {
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('nav');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();

      navMenu.classList.toggle('active');
      document.body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : '';

      // Animate hamburger menu
      const spans = navToggle.querySelectorAll('span');
      if (navMenu.classList.contains('active')) {
        spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'rotate(-45deg) translate(7px, -6px)';
      } else {
        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
      }
    });

    // Close menu when clicking on a link
    const navLinks = document.querySelectorAll('nav a');
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
        document.body.style.overflow = '';
        const spans = navToggle.querySelectorAll('span');
        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
      });
    });

    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
      if (!navMenu.contains(e.target) && !navToggle.contains(e.target) && navMenu.classList.contains('active')) {
        navMenu.classList.remove('active');
        document.body.style.overflow = '';
        const spans = navToggle.querySelectorAll('span');
        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
      }
    });
  }
});

/ ============================================================================
// GLOBAL IN-APP PDF VIEWER (Zoom Fixed, Watermarks, Counter + PC Security)
// ============================================================================

function openInAppViewer(pdfUrl, title) {
  // 1. Create the overlay HTML with PC Security (oncontextmenu & user-select)
  const viewerHtml = `
    <div id="pdf-viewer-overlay" oncontextmenu="return false;" style="position:fixed; top:0; left:0; width:100%; height:100%; z-index:99999; background:#e2e8f0; display:flex; flex-direction:column; animation: slideUp 0.3s ease; user-select: none; -webkit-user-select: none;">

      <!-- Top Navigation Bar -->
      <div style="padding: 15px 25px; background: #0f172a; color: white; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 10px rgba(0,0,0,0.2); z-index: 10;">
        <div style="display: flex; align-items: center; gap: 15px;">
          <h3 style="margin:0; font-size: 1.1rem; font-weight: 600;">${title}</h3>
        </div>
        <button onclick="closeInAppViewer()" style="background: #ef4444; color: white; border: none; padding: 8px 20px; border-radius: 50px; cursor: pointer; font-weight: 700; transition: all 0.2s ease;">
          <i class="fas fa-times"></i> Close
        </button>
      </div>

      <!-- Floating Zoom Controls (Right) -->
      <div style="position: absolute; bottom: 30px; right: 30px; display: flex; flex-direction: column; gap: 10px; z-index: 20;">
        <button id="zoom-in-btn" style="width: 50px; height: 50px; border-radius: 50%; background: #6366f1; color: white; border: none; box-shadow: 0 4px 15px rgba(0,0,0,0.3); font-size: 1.2rem; cursor: pointer;">
          <i class="fas fa-search-plus"></i>
        </button>
        <button id="zoom-out-btn" style="width: 50px; height: 50px; border-radius: 50%; background: #6366f1; color: white; border: none; box-shadow: 0 4px 15px rgba(0,0,0,0.3); font-size: 1.2rem; cursor: pointer;">
          <i class="fas fa-search-minus"></i>
        </button>
      </div>

      <!-- Floating Page Indicator (Left) -->
      <div id="page-indicator" style="position: absolute; bottom: 30px; left: 30px; background: rgba(15, 23, 42, 0.9); color: white; padding: 10px 20px; border-radius: 50px; font-weight: 600; font-size: 1rem; z-index: 20; box-shadow: 0 4px 15px rgba(0,0,0,0.3); backdrop-filter: blur(4px); display: none;">
        <i class="fas fa-file-pdf" style="margin-right: 5px; color: #cbd5e1;"></i> <span id="current-page">1</span> / <span id="total-pages">...</span>
      </div>

      <!-- PDF Rendering Container -->
      <div id="pdf-render-container" style="flex:1; overflow:auto; padding: 15px; display:block; text-align:center; -webkit-overflow-scrolling: touch;">
         <div id="pdf-loading" style="margin-top: 50px; font-weight: bold; color: #475569; font-size: 1.1rem; display: inline-block;">
           <i class="fas fa-spinner fa-spin"></i> Loading High-Quality Notes...
         </div>
      </div>

    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', viewerHtml);

  // 1.5 Security: Block PC Keyboard Shortcuts (Ctrl+S, Ctrl+P, Ctrl+C)
  const blockShortcuts = (e) => {
    if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'c', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', blockShortcuts);

  let isClosed = false;

  // Expose close function globally to clean up the keyboard listeners
  window.closeInAppViewer = function() {
    isClosed = true;
    const overlay = document.getElementById('pdf-viewer-overlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', blockShortcuts);
  };

  // 2. Zoom state.
  // currentZoom is a multiplier applied on top of each page's own "fit to
  // container" base scale. Changing it now triggers a real re-render of every
  // page at the new target resolution — the old version just CSS-stretched
  // the already-rasterized canvas, which is what made notes look progressively
  // worse the more someone zoomed in to read fine handwriting.
  let currentZoom = 1;
  let isRendering = false;
  let queuedZoom = null;

  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');

  zoomInBtn.onclick = () => requestZoom(Math.min(currentZoom + 0.25, 3.0));
  zoomOutBtn.onclick = () => requestZoom(Math.max(currentZoom - 0.25, 0.75));

  function requestZoom(newZoom) {
    currentZoom = newZoom;
    if (isRendering) {
      // A render is already in flight for this page set — remember the latest
      // requested zoom instead of firing a second page.render() on the same
      // canvas (pdf.js throws if you do that while one is still running).
      queuedZoom = newZoom;
      return;
    }
    runRender(newZoom);
  }

  async function runRender(zoomValue) {
    isRendering = true;
    zoomInBtn.style.opacity = '0.5';
    zoomOutBtn.style.opacity = '0.5';

    await renderAllPages(zoomValue);

    if (isClosed) return;

    if (queuedZoom !== null && queuedZoom !== zoomValue) {
      const next = queuedZoom;
      queuedZoom = null;
      await runRender(next);
      return;
    }
    queuedZoom = null;
    isRendering = false;
    zoomInBtn.style.opacity = '1';
    zoomOutBtn.style.opacity = '1';
  }

  // 3. Dynamically load the PDF.js library
  if (typeof pdfjsLib === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => loadPDF(pdfUrl);
    document.body.appendChild(script);
  } else {
    loadPDF(pdfUrl);
  }

  // Cache of { page, baseScale } per page number, plus each page's <canvas>,
  // so re-rendering on zoom reuses the same pdf.js page object and the same
  // DOM node instead of recreating everything — that keeps scroll position
  // and the page-indicator's IntersectionObserver bindings intact.
  const pageCache = new Map();
  const canvasByPage = new Map();
  let pdfDoc = null;

  const userName = localStorage.getItem('userName') || 'Authorized Student';
  const userEmail = localStorage.getItem('userEmail') || 'SayHeyShubh Viewer';
  const watermarkText = `${userName} | ${userEmail}`;

  function loadPDF(url) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const loadingTask = pdfjsLib.getDocument(url);
    loadingTask.promise.then(async function(pdf) {
      if (isClosed) return;
      pdfDoc = pdf;
      const container = document.getElementById('pdf-render-container');
      const loader = document.getElementById('pdf-loading');
      if (loader) loader.remove();

      document.getElementById('total-pages').textContent = pdf.numPages;
      document.getElementById('page-indicator').style.display = 'block';

      const pageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            document.getElementById('current-page').textContent = entry.target.dataset.pageNumber;
          }
        });
      }, { root: container, rootMargin: '-30% 0px -30% 0px', threshold: 0 });

      // Pre-fetch every page once and work out its "fit to container" base
      // scale up front, then do the first paint through the same code path
      // zoom will reuse later.
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (isClosed) return;
        const page = await pdf.getPage(pageNum);
        const containerWidth = container.clientWidth - 30;
        const unscaledViewport = page.getViewport({ scale: 1 });
        let baseScale = containerWidth / unscaledViewport.width;
        if (baseScale > 1.5) baseScale = 1.5;

        pageCache.set(pageNum, { page, baseScale });

        const canvas = document.createElement('canvas');
        canvas.classList.add('pdf-page-canvas');
        canvas.dataset.pageNumber = pageNum;
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto 20px auto';
        canvas.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
        canvas.style.borderRadius = '8px';
        canvas.style.maxWidth = 'none';
        canvas.style.userSelect = 'none';
        canvas.style.webkitUserSelect = 'none';
        canvas.style.webkitTouchCallout = 'none';
        canvas.oncontextmenu = () => false;
        canvas.ondragstart = () => false; // Stops users from dragging the image to desktop

        container.appendChild(canvas);
        canvasByPage.set(pageNum, canvas);
        pageObserver.observe(canvas);
      }

      isRendering = true;
      await renderAllPages(1);
      isRendering = false;
    }).catch(function(error) {
      console.error('Error rendering PDF:', error);
      const loader = document.getElementById('pdf-loading');
      if (loader) loader.innerHTML = 'Error loading PDF. Please check your internet connection.';
    });
  }

  // Renders (or re-renders) every page's canvas at baseScale * zoomValue,
  // always at full devicePixelRatio resolution. This is what actually keeps
  // zoomed-in notes sharp, instead of CSS-stretching a lower-res bitmap.
  async function renderAllPages(zoomValue) {
    if (!pdfDoc || isClosed) return;
    const container = document.getElementById('pdf-render-container');
    if (!container) return;
    const outputScale = window.devicePixelRatio || 1;

    // Preserve the reader's scroll position (as a ratio) across the resize,
    // so zooming doesn't yank them back to the top of the document.
    const prevScrollHeight = container.scrollHeight || 1;
    const prevScrollRatio = container.scrollTop / prevScrollHeight;

    for (const [pageNum, { page, baseScale }] of pageCache) {
      if (isClosed) return;
      const canvas = canvasByPage.get(pageNum);
      if (!canvas) continue;

      const targetScale = baseScale * zoomValue;
      const viewport = page.getViewport({ scale: targetScale });

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.dataset.baseWidth = Math.floor(viewport.width);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = 'auto';

      const ctx = canvas.getContext('2d');
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

      await page.render({ canvasContext: ctx, transform: transform, viewport: viewport }).promise;
      if (isClosed) return;

      // Draw Watermarks
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 4);

      // Responsive Font Size: Checks if screen is mobile to shrink the font appropriately
      const baseFontSize = window.innerWidth < 768 ? 14 : 26;
      ctx.font = `bold ${Math.floor(baseFontSize * outputScale)}px Arial`;
      ctx.fillStyle = "rgba(100, 116, 139, 0.20)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillText(watermarkText, 0, -canvas.height / 2.5);
      ctx.fillText(watermarkText, 0, canvas.height / 2.5);
      ctx.fillText(watermarkText, -canvas.width / 2.5, 0);
      ctx.fillText(watermarkText, canvas.width / 2.5, 0);

      ctx.restore();
    }

    if (isClosed) return;
    const newScrollHeight = container.scrollHeight || 1;
    container.scrollTop = prevScrollRatio * newScrollHeight;
  }
}
