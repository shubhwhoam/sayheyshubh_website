class SemesterNotesLoader {
  constructor(semesterKey) {
    this.semesterKey = semesterKey;
    this.notesData = null;
    this.auth = null;
    this.currentNoteUrl = '';
    this.currentNoteTitle = '';
  }

  async initialize(firebaseAuth) {
    this.auth = firebaseAuth;
    await this.loadNotes();
    this.attachPaymentHandlers();
  }

  async loadNotes() {
    try {
      const user = this.auth.currentUser;
      if (!user) {
        console.error('User not authenticated - cannot load notes');
        this.showError('Please log in to view notes.');
        // Redirect to login page
        setTimeout(() => {
          window.location.href = 'youtube.html?showLogin=true';
        }, 1500);
        return;
      }

      console.log('Loading notes for semester:', this.semesterKey);
      const idToken = await user.getIdToken();
      
      const response = await fetch(`/.netlify/functions/get-notes?semester=${this.semesterKey}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('Notes API response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Notes API error:', errorText);
        throw new Error(`Failed to load notes: ${response.status}`);
      }

      const result = await response.json();
      console.log('Notes loaded successfully:', result.success);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to load notes');
      }

      this.notesData = result.data;
      this.renderNotes();
    } catch (error) {
      console.error('Error loading notes:', error);
      this.showError('Failed to load notes. Please refresh the page.');
    }
  }

  renderNotes() {
    if (!this.notesData || !this.notesData.subjects) {
      return;
    }

    const container = document.getElementById('subjectsContainer');
    if (!container) {
      console.error('Subjects container not found');
      return;
    }

    container.innerHTML = '';

    Object.keys(this.notesData.subjects).forEach((subjectName, index) => {
      const subject = this.notesData.subjects[subjectName];
      const subjectCard = this.createSubjectCard(subjectName, subject);
      container.appendChild(subjectCard);
    });
  }

  createSubjectCard(subjectName, subject) {
    const card = document.createElement('div');
    card.className = `subject-dropdown ${subject.color || 'subject-color-1'}`;

    const header = document.createElement('div');
    header.className = 'subject-header';
    header.onclick = () => this.toggleSubject(header);
    header.innerHTML = `
      ${subjectName}
      <span class="expand-icon">▼</span>
    `;

    const content = document.createElement('div');
    content.className = 'units-content';

    subject.units.forEach(unit => {
      const unitItem = this.createUnitItem(unit);
      content.appendChild(unitItem);
    });

    card.appendChild(header);
    card.appendChild(content);

    return card;
  }

  createUnitItem(unit) {
    const unitItem = document.createElement('div');
    unitItem.className = 'unit-item';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'unit-title';
    titleSpan.innerHTML = unit.title;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'unit-buttons';

    if (unit.videoUrl) {
      const videoBtn = document.createElement('a');
      videoBtn.href = unit.videoUrl;
      videoBtn.target = '_blank';
      videoBtn.className = 'watch-btn';
      videoBtn.innerHTML = '▶️ Watch Video';
      buttonsDiv.appendChild(videoBtn);
    }

    if (unit.status === 'coming-soon') {
      const comingSoonSpan = document.createElement('span');
      comingSoonSpan.className = 'coming-soon';
      comingSoonSpan.textContent = 'Coming Soon';
      buttonsDiv.appendChild(comingSoonSpan);
    } else if (unit.noteId) {
      const noteBtn = document.createElement('a');
      noteBtn.className = 'download-btn';
      
      if (unit.hasAccess) {
        noteBtn.innerHTML = '📥 View Notes';
        noteBtn.style.cursor = 'pointer';
        noteBtn.onclick = (e) => {
          e.preventDefault();
          this.openSecureNote(unit.noteId, unit.title);
        };
      } else {
        noteBtn.innerHTML = '🔒 Unlock Notes';
        noteBtn.style.background = '#f59e0b';
        noteBtn.style.cursor = 'pointer';
        noteBtn.onclick = (e) => {
          e.preventDefault();
          this.showPaymentPopup(unit.noteId, unit.title);
        };
      }
      
      buttonsDiv.appendChild(noteBtn);
    }

    unitItem.appendChild(titleSpan);
    unitItem.appendChild(buttonsDiv);

    return unitItem;
  }

  toggleSubject(header) {
    const content = header.nextElementSibling;
    const icon = header.querySelector('.expand-icon');
    const isExpanded = content.classList.contains('expanded');

    if (isExpanded) {
      content.classList.remove('expanded');
      icon.classList.remove('rotated');
    } else {
      content.classList.add('expanded');
      icon.classList.add('rotated');
    }
  }

  async openSecureNote(noteId, noteTitle) {
    try {
      const user = this.auth.currentUser;
      const idToken = await user.getIdToken();

      const response = await fetch(`/.netlify/functions/secure-notes?noteId=${noteId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch note: ${response.status}`);
      }

      const noteData = await response.json();
      if (!noteData.success) {
        throw new Error(noteData.error || 'Failed to access note');
      }

      window.open(noteData.noteUrl, '_blank');
    } catch (error) {
      console.error('Error opening note:', error);
      alert('Failed to open note. You may need to unlock this note first.');
    }
  }

  showPaymentPopup(noteId, noteTitle) {
    this.currentNoteId = noteId;
    this.currentNoteTitle = noteTitle;

    const modal = document.getElementById('paymentModal');
    if (modal) {
      modal.classList.add('show');
      document.getElementById('paymentNoteTitle').textContent = noteTitle;
    }
  }

  attachPaymentHandlers() {
    const priceOptions = document.querySelectorAll('.price-option');
    priceOptions.forEach(option => {
      option.addEventListener('click', () => {
        priceOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
      });
    });
  }

  showError(message) {
    const container = document.getElementById('subjectsContainer');
    if (container) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem; background: #fee; border-radius: 10px; color: #c33;">
          <p>${message}</p>
          <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer;">
            Reload Page
          </button>
        </div>
      `;
    }
  }

  getCurrentNoteId() {
    return this.currentNoteId;
  }

  getCurrentNoteTitle() {
    return this.currentNoteTitle;
  }
}

function hidePaymentPopup() {
  const modal = document.getElementById('paymentModal');
  if (modal) {
    modal.classList.remove('show');
  }
}

async function proceedToPayment() {
  if (!window.semesterNotesLoader) {
    alert('Error: Notes system not initialized');
    return;
  }

  const selectedPrice = document.querySelector('.price-option.selected');
  if (!selectedPrice) {
    alert('Please select a price');
    return;
  }

  const amount = parseInt(selectedPrice.getAttribute('data-price')) * 100;
  const noteTitle = window.semesterNotesLoader.getCurrentNoteTitle();
  const noteId = window.semesterNotesLoader.getCurrentNoteId();

  const loadingDiv = document.getElementById('paymentLoading');
  if (loadingDiv) {
    loadingDiv.classList.add('show');
  }

  try {
    const user = firebase.auth().currentUser;
    const idToken = await user.getIdToken();

    const orderResponse = await fetch('/.netlify/functions/create-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        amount: amount,
        noteTitle: noteTitle,
        noteId: noteId
      })
    });

    const orderData = await orderResponse.json();

    if (!orderData.success || !orderData.orderId) {
      throw new Error(orderData.error || 'Failed to create order');
    }

    const options = {
      key: orderData.razorpayKeyId,
      amount: amount,
      currency: 'INR',
      name: 'ShubhiPhilia Notes',
      description: noteTitle,
      order_id: orderData.orderId,
      handler: async function(response) {
        await verifyPayment(response.razorpay_payment_id, response.razorpay_order_id, response.razorpay_signature);
      },
      prefill: {
        name: user.displayName || '',
        email: user.email || '',
        contact: user.phoneNumber || ''
      },
      theme: {
        color: '#6366f1'
      }
    };

    const razorpay = new Razorpay(options);
    razorpay.open();

    if (loadingDiv) {
      loadingDiv.classList.remove('show');
    }
    hidePaymentPopup();

  } catch (error) {
    console.error('Payment error:', error);
    if (loadingDiv) {
      loadingDiv.classList.remove('show');
    }
    alert('Payment failed. Please try again.');
  }
}

async function verifyPayment(paymentId, orderId, signature) {
  try {
    const user = firebase.auth().currentUser;
    const idToken = await user.getIdToken();

    const response = await fetch('/.netlify/functions/verify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        paymentId: paymentId,
        orderId: orderId,
        signature: signature
      })
    });

    const result = await response.json();

    if (result.success && result.verified) {
      alert('Payment successful! Your note has been unlocked.');
      setTimeout(() => {
        location.reload();
      }, 1500);
    } else {
      throw new Error(result.error || 'Payment verification failed');
    }
  } catch (error) {
    console.error('Verification error:', error);
    alert('Payment verification failed. Please contact support if money was deducted.');
  }
}

async function previewNote() {
  if (!window.semesterNotesLoader) {
    alert('Error: Notes system not initialized');
    return;
  }

  const noteUrl = window.semesterNotesLoader.getCurrentNoteUrl();
  if (noteUrl) {
    window.open(noteUrl, '_blank');
  }
}
