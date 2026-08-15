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
// GLOBAL IN-APP PDF VIEWER (Zoom Fixed + Dynamic Watermarking)
// ============================================================================

function openInAppViewer(pdfUrl, title) {
  // 1. Create the overlay HTML (Flexbox center bug fixed)
  const viewerHtml = `
    <div id="pdf-viewer-overlay" style="position:fixed; top:0; left:0; width:100%; height:100%; z-index:99999; background:#e2e8f0; display:flex; flex-direction:column; animation: slideUp 0.3s ease;">

      <!-- Top Navigation Bar -->
      <div style="padding: 15px 25px; background: #0f172a; color: white; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 10px rgba(0,0,0,0.2); z-index: 10;">
        <div style="display: flex; align-items: center; gap: 15px;">
          <h3 style="margin:0; font-size: 1.1rem; font-weight: 600;">${title}</h3>
        </div>
        <button onclick="document.getElementById('pdf-viewer-overlay').remove()" style="background: #ef4444; color: white; border: none; padding: 8px 20px; border-radius: 50px; cursor: pointer; font-weight: 700; transition: all 0.2s ease;">
          <i class="fas fa-times"></i> Close
        </button>
      </div>

      <!-- Floating Zoom Controls -->
      <div style="position: absolute; bottom: 30px; right: 30px; display: flex; flex-direction: column; gap: 10px; z-index: 20;">
        <button id="zoom-in-btn" style="width: 50px; height: 50px; border-radius: 50%; background: #6366f1; color: white; border: none; box-shadow: 0 4px 15px rgba(0,0,0,0.3); font-size: 1.2rem; cursor: pointer;">
          <i class="fas fa-search-plus"></i>
        </button>
        <button id="zoom-out-btn" style="width: 50px; height: 50px; border-radius: 50%; background: #6366f1; color: white; border: none; box-shadow: 0 4px 15px rgba(0,0,0,0.3); font-size: 1.2rem; cursor: pointer;">
          <i class="fas fa-search-minus"></i>
        </button>
      </div>

      <!-- PDF Rendering Container (Using block/text-center to fix left-margin scroll bug) -->
      <div id="pdf-render-container" style="flex:1; overflow:auto; padding: 15px; display:block; text-align:center; -webkit-overflow-scrolling: touch;">
         <div id="pdf-loading" style="margin-top: 50px; font-weight: bold; color: #475569; font-size: 1.1rem; display: inline-block;">
           <i class="fas fa-spinner fa-spin"></i> Loading High-Quality Notes...
         </div>
      </div>

    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', viewerHtml);

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

  // 3. Dynamically load the PDF.js library ONLY when needed
  if (typeof pdfjsLib === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => renderPDF(pdfUrl);
    document.body.appendChild(script);
  } else {
    renderPDF(pdfUrl);
  }

  // 4. The actual rendering logic with Watermarks
  function renderPDF(url) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // Get user details for the watermark
    const userName = localStorage.getItem('userName') || 'Authorized Student';
    const userEmail = localStorage.getItem('userEmail') || 'SayHeyShubh Viewer';
    const watermarkText = `${userName} | ${userEmail}`;

    const loadingTask = pdfjsLib.getDocument(url);
    loadingTask.promise.then(async function(pdf) {
      const container = document.getElementById('pdf-render-container');
      const loader = document.getElementById('pdf-loading');
      if (loader) loader.remove();

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);

        const containerWidth = container.clientWidth - 30; 
        let unscaledViewport = page.getViewport({ scale: 1 });
        let scale = containerWidth / unscaledViewport.width;
        if (scale > 1.5) scale = 1.5; 

        const viewport = page.getViewport({ scale: scale });

        // HIGH-DPI FIX
        const outputScale = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);

        const baseCssWidth = Math.floor(viewport.width);
        canvas.dataset.baseWidth = baseCssWidth;
        canvas.style.width = baseCssWidth + "px";
        canvas.style.height = "auto"; 
        canvas.classList.add('pdf-page-canvas');

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

        // Styling and Anti-Piracy CSS
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto 20px auto';
        canvas.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
        canvas.style.borderRadius = '8px';
        canvas.style.maxWidth = 'none'; 
        canvas.style.userSelect = 'none';
        canvas.style.webkitUserSelect = 'none';
        canvas.style.webkitTouchCallout = 'none';
        canvas.oncontextmenu = () => false; 

        container.appendChild(canvas);

        const renderContext = { canvasContext: ctx, transform: transform, viewport: viewport };

        // Wait for the PDF page to physically draw onto the canvas
        await page.render(renderContext).promise;

        // --- DRAW DYNAMIC WATERMARKS OVER THE PDF ---
        ctx.save();
        // Move origin to the exact center of the page
        ctx.translate(canvas.width / 2, canvas.height / 2);
        // Rotate it diagonally
        ctx.rotate(-Math.PI / 4);

        // Font styling (Responsive to high-DPI screens)
        ctx.font = `bold ${Math.floor(30 * outputScale)}px Arial`;
        ctx.fillStyle = "rgba(100, 116, 139, 0.20)"; // Subtle grayish-blue, 20% opacity
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Stamp it in the center and in the corners to prevent easy cropping
        ctx.fillText(watermarkText, 0, 0);
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