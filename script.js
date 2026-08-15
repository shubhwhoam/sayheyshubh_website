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

// ============================================================================
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

  // Expose close function globally to clean up the keyboard listeners
  window.closeInAppViewer = function() {
    const overlay = document.getElementById('pdf-viewer-overlay');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', blockShortcuts);
  };

  // 2. Zoom State and Logic
  let currentZoom = 1;

  document.getElementById('zoom-in-btn').onclick = () => {
    if (currentZoom < 3.0) currentZoom += 0.25;
    applyZoom();
  };

  document.getElementById('zoom-out-btn').onclick = () => {
    if (currentZoom > 0.75) currentZoom -= 0.25;
    applyZoom();
  };

  function applyZoom() {
    document.querySelectorAll('.pdf-page-canvas').forEach(canvas => {
      const baseWidth = parseInt(canvas.dataset.baseWidth);
      canvas.style.width = Math.floor(baseWidth * currentZoom) + 'px';
    });
  }

  // 3. Dynamically load the PDF.js library
  if (typeof pdfjsLib === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => renderPDF(pdfUrl);
    document.body.appendChild(script);
  } else {
    renderPDF(pdfUrl);
  }

  // 4. The actual rendering logic with Watermarks & Observers
  function renderPDF(url) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const userName = localStorage.getItem('userName') || 'Authorized Student';
    const userEmail = localStorage.getItem('userEmail') || 'SayHeyShubh Viewer';
    const watermarkText = `${userName} | ${userEmail}`;

    const loadingTask = pdfjsLib.getDocument(url);
    loadingTask.promise.then(async function(pdf) {
      const container = document.getElementById('pdf-render-container');
      const loader = document.getElementById('pdf-loading');
      if (loader) loader.remove();

      // Show Page Counter
      document.getElementById('total-pages').textContent = pdf.numPages;
      document.getElementById('page-indicator').style.display = 'block';

      // Set up the Intersection Observer to track which page is on screen
      const observerOptions = {
        root: container,
        rootMargin: '-30% 0px -30% 0px',
        threshold: 0
      };
      const pageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            document.getElementById('current-page').textContent = entry.target.dataset.pageNumber;
          }
        });
      }, observerOptions);

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);

        const containerWidth = container.clientWidth - 30; 
        let unscaledViewport = page.getViewport({ scale: 1 });
        let scale = containerWidth / unscaledViewport.width;
        if (scale > 1.5) scale = 1.5; 

        const viewport = page.getViewport({ scale: scale });
        const outputScale = window.devicePixelRatio || 1;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);

        const baseCssWidth = Math.floor(viewport.width);
        canvas.dataset.baseWidth = baseCssWidth;
        canvas.dataset.pageNumber = pageNum; 

        canvas.style.width = baseCssWidth + "px";
        canvas.style.height = "auto"; 
        canvas.classList.add('pdf-page-canvas');

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

        canvas.style.display = 'block';
        canvas.style.margin = '0 auto 20px auto';
        canvas.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
        canvas.style.borderRadius = '8px';
        canvas.style.maxWidth = 'none'; 

        // PC & Mobile Security Properties
        canvas.style.userSelect = 'none';
        canvas.style.webkitUserSelect = 'none';
        canvas.style.webkitTouchCallout = 'none';
        canvas.oncontextmenu = () => false; 
        canvas.ondragstart = () => false; // Stops users from dragging the image to desktop

        container.appendChild(canvas);

        pageObserver.observe(canvas);

        const renderContext = { canvasContext: ctx, transform: transform, viewport: viewport };
        await page.render(renderContext).promise;

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

        // Removed the center text! Now it only stamps in the 4 quadrants.
        ctx.fillText(watermarkText, 0, -canvas.height / 2.5);
        ctx.fillText(watermarkText, 0, canvas.height / 2.5);
        ctx.fillText(watermarkText, -canvas.width / 2.5, 0);
        ctx.fillText(watermarkText, canvas.width / 2.5, 0);

        ctx.restore();
      }
    }).catch(function(error) {
      console.error('Error rendering PDF:', error);
      const loader = document.getElementById('pdf-loading');
      if (loader) loader.innerHTML = 'Error loading PDF. Please check your internet connection.';
    });
  }
}