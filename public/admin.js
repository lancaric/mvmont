document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('admin-token');
  const saveTokenBtn = document.getElementById('save-token');
  const clearTokenBtn = document.getElementById('clear-token');
  const statusBadge = document.getElementById('status-badge');
  const tokenHint = document.getElementById('token-hint');
  const form = document.getElementById('gallery-form');
  const formTitle = document.getElementById('form-title');
  const formMessage = document.getElementById('form-message');
  const resetFormBtn = document.getElementById('reset-form');
  const refreshBtn = document.getElementById('refresh-gallery');
  const galleryList = document.getElementById('gallery-list');

  let currentEditId = null;

  const savedToken = localStorage.getItem('adminToken');
  if (savedToken) {
    tokenInput.value = savedToken;
    setStatus('token uložený', 'bg-emerald-100 text-emerald-700 border-emerald-200');
  } else {
    setStatus('neoverené', 'bg-slate-100 text-slate-600 border-slate-200');
  }

  tokenHint.textContent = 'Token sa ukladá len vo vašom prehliadači (localStorage).';

  saveTokenBtn.addEventListener('click', () => {
    localStorage.setItem('adminToken', tokenInput.value.trim());
    setStatus('token uložený', 'bg-emerald-100 text-emerald-700 border-emerald-200');
    notify('Token uložený.');
  });

  clearTokenBtn.addEventListener('click', () => {
    tokenInput.value = '';
    localStorage.removeItem('adminToken');
    setStatus('neoverené', 'bg-slate-100 text-slate-600 border-slate-200');
    notify('Token odstránený.');
  });

  resetFormBtn.addEventListener('click', () => {
    resetForm();
    notify('Formulár vynulovaný.');
  });

  refreshBtn.addEventListener('click', () => loadGallery());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    let payload;
    try { payload = await buildPayloadFromForm(); }
    catch { setFormMessage('Obrázok sa nepodarilo načítať.', 'text-red-600'); return; }
    if (!payload) return;

    const endpoint = currentEditId ? `/api/gallery/${currentEditId}` : '/api/gallery';
    const method = currentEditId ? 'PUT' : 'POST';
    setFormMessage('Ukladám...', 'text-blue-700');

    try {
      const response = await fetch(endpoint, {
        method,
        headers: withAuth(),
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || 'Nepodarilo sa uložiť položku.');
      }

      notify(currentEditId ? 'Položka upravená.' : 'Položka pridaná.');
      resetForm();
      await loadGallery();
    } catch (error) {
      setFormMessage(error.message, 'text-red-600');
      console.error(error);
    }
  });

  async function loadGallery() {
    galleryList.innerHTML = '<p class="text-sm text-slate-500">Načítavam...</p>';
    try {
      const response = await fetch('/api/gallery');
      if (!response.ok) throw new Error('Galéria nie je dostupná');
      const data = await response.json();
      const items = data?.items || [];
      renderGallery(items);
    } catch (error) {
      galleryList.innerHTML = '<p class="text-sm text-red-600">Nepodarilo sa načítať galériu.</p>';
      console.error(error);
    }
  }

  function renderGallery(items) {
    if (!items.length) {
      galleryList.innerHTML = '<p class="text-sm text-slate-500">Žiadne položky.</p>';
      return;
    }

    galleryList.innerHTML = items
      .map(
        (item) => `
        <article class="border border-slate-200 rounded-xl bg-slate-50 overflow-hidden shadow-sm flex flex-col">
          <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" class="h-48 w-full object-cover bg-slate-100" />
          <div class="p-4 flex-1 flex flex-col gap-2">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h3 class="text-base font-semibold text-slate-900">${escapeHtml(item.title)}</h3>
                <p class="text-sm text-slate-600">${escapeHtml(item.description || '')}</p>
              </div>
              <span class="text-xs px-2 py-1 rounded-full bg-slate-200 text-slate-700 uppercase">${escapeHtml(
                item.category || ''
              )}</span>
            </div>
            <div class="mt-auto flex gap-2 pt-2">
              <button
                class="flex-1 px-3 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800"
                data-edit="${escapeHtml(item.id)}"
              >
                Upraviť
              </button>
              <button
                class="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
                data-delete="${escapeHtml(item.id)}"
              >
                Odstrániť
              </button>
            </div>
          </div>
        </article>
      `
      )
      .join('');

    galleryList.querySelectorAll('[data-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.getAttribute('data-edit');
        const item = items.find((entry) => entry.id === id);
        if (item) {
          populateForm(item);
          notify('Formulár vyplnený na úpravu.');
        }
      });
    });

    galleryList.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.getAttribute('data-delete');
        if (!confirm('Naozaj chcete položku odstrániť?')) return;
        try {
          const response = await fetch(`/api/gallery/${id}`, {
            method: 'DELETE',
            headers: withAuth(),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.message || 'Odstránenie zlyhalo.');
          }
          notify('Položka odstránená.');
          if (currentEditId === id) resetForm();
          await loadGallery();
        } catch (error) {
          notify(error.message, 'text-red-600');
        }
      });
    });
  }

  function resetForm() {
    form.reset();
    currentEditId = null;
    formTitle.textContent = 'Nová položka';
    setFormMessage('');
  }

  function populateForm(item) {
    currentEditId = item.id;
    formTitle.textContent = 'Upraviť položku';
    form.querySelector('#title').value = item.title || '';
    form.querySelector('#description').value = item.description || '';
    form.querySelector('#category').value = item.category || '';
    form.querySelector('#imageUrl').value = item.imageUrl || '';
    form.querySelector('#imageFile').value = '';
  }

  async function buildPayloadFromForm() {
    const title = form.querySelector('#title').value.trim();
    const description = form.querySelector('#description').value.trim();
    const category = form.querySelector('#category').value.trim();
    const imageUrl = form.querySelector('#imageUrl').value.trim();
    const imageFile = form.querySelector('#imageFile').files?.[0];

    if (!title || !category) {
      setFormMessage('Názov a kategória sú povinné.', 'text-red-600');
      return null;
    }

    const payload = { title, description, category };

    if (imageFile) {
      if (imageFile.size > 3 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(imageFile.type)) {
        setFormMessage('Nahrajte PNG, JPG, WEBP alebo GIF s veľkosťou najviac 3 MiB.', 'text-red-600');
        return null;
      }
      payload.imageData = await fileToBase64(imageFile);
      payload.imageName = imageFile.name;
    } else if (imageUrl) {
      payload.imageUrl = imageUrl;
    } else if (!currentEditId) {
      setFormMessage('Pridajte URL alebo nahraný obrázok.', 'text-red-600');
      return null;
    }

    return payload;
  }

  function withAuth() {
    const headers = { 'Content-Type': 'application/json' };
    const token = tokenInput.value.trim();
    if (token) headers['X-Admin-Token'] = token;
    return headers;
  }

  function setStatus(text, classes) {
    statusBadge.textContent = text;
    statusBadge.className = `text-xs px-3 py-1 rounded-full border ${classes}`;
  }

  function setFormMessage(message, classes = 'text-slate-500') {
    formMessage.textContent = message;
    formMessage.className = `text-sm ${classes}`;
  }

  function notify(message, classes = 'text-green-700') {
    setFormMessage(message, classes);
  }

  function escapeHtml(text = '') {
    return String(text).replace(/[&<>"']/g, (char) => {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return map[char] || char;
    });
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result || '';
        const base64 = result.toString().split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  loadGallery();
});
