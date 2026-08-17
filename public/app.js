let operationTrigger = null;
let pendingConfirmation = null;

function readClientI18n() {
  try {
    const value = JSON.parse(document.getElementById('client-i18n')?.textContent ?? '{}');
    return { locale: typeof value.locale === 'string' ? value.locale : 'en-GB', messages: value.messages ?? {} };
  } catch { return { locale: 'en-GB', messages: {} }; }
}
const clientI18n = readClientI18n();
const clientMessage = (key, fallback = key) => typeof clientI18n.messages[key] === 'string' ? clientI18n.messages[key] : fallback;
const formatPercent = (value) => new Intl.NumberFormat(clientI18n.locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);

function updateThemeToggle() {
  const toggle = document.querySelector('[data-theme-toggle]');
  if (!toggle) return;
  const isDark = document.documentElement.dataset.theme === 'dark';
  const label = clientMessage(isDark ? 'client.theme.enableLight' : 'client.theme.enableDark');
  toggle.setAttribute('aria-pressed', String(isDark));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}

function updateAccentToggle() {
  const toggle = document.querySelector('[data-accent-toggle]');
  if (!toggle) return;
  const isBlue = document.documentElement.dataset.accent === 'blue';
  const label = clientMessage(isBlue ? 'client.accent.switchToRed' : 'client.accent.switchToBlue');
  toggle.setAttribute('aria-pressed', String(isBlue));
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}

document.addEventListener('DOMContentLoaded', () => {
  updateThemeToggle();
  updateAccentToggle();
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    document.cookie = `theme=${root.dataset.theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    updateThemeToggle();
  });
  document.querySelector('[data-accent-toggle]')?.addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.accent = root.dataset.accent === 'blue' ? 'red' : 'blue';
    document.cookie = `accent=${root.dataset.accent}; Path=/; Max-Age=31536000; SameSite=Lax`;
    updateAccentToggle();
  });
  const languageForm = document.querySelector('[data-language-form]');
  const languageSelect = document.getElementById('ui-language');
  const languageSubmit = languageForm?.querySelector('.language-submit');
  if (languageForm && languageSelect && languageSubmit) {
    languageSelect.addEventListener('change', () => {
      sessionStorage.setItem('restore-language-focus', 'true');
      languageForm.requestSubmit();
    });
  }
  if (sessionStorage.getItem('restore-language-focus') === 'true') {
    sessionStorage.removeItem('restore-language-focus');
    languageSelect?.focus();
  }
});

let renameTrigger = null;
let compressTrigger = null;

function closeRenameDialog(restoreFocus = true) {
  const dialog = document.getElementById('rename-dialog');
  if (dialog?.open) dialog.close();
  if (restoreFocus && renameTrigger?.isConnected) renameTrigger.focus();
  if (restoreFocus) renameTrigger = null;
}

function closeCompressDialog(restoreFocus = true) {
  const dialog = document.getElementById('compress-dialog');
  if (dialog?.open) dialog.close();
  if (restoreFocus && compressTrigger?.isConnected) compressTrigger.focus();
  if (restoreFocus) compressTrigger = null;
}

function validateRenameForm() {
  const dialog = document.getElementById('rename-dialog');
  const input = dialog?.querySelector('#rename-new-base');
  const error = dialog?.querySelector('#rename-error');
  const original = dialog?.querySelector('#rename-original-filename')?.value ?? '';
  if (!input || !error) return false;

  const value = input.value.trim();
  const suffix = dialog.querySelector('#rename-suffix')?.textContent ?? '';
  let message = '';
  if (!value) message = clientMessage('validation.renameBaseRequired');
  else if (!/^[\p{L}\p{N} _().-]+$/u.test(value) || value.startsWith('.')) {
    message = clientMessage('validation.renameBaseCharactersInvalid');
  } else if (`${value}${suffix}` === original) message = clientMessage('validation.filenameUnchanged');

  input.setAttribute('aria-invalid', String(Boolean(message)));
  error.textContent = message;
  if (message) input.focus();
  return !message;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-rename]');
  if (!button) return;
  const dialog = document.getElementById('rename-dialog');
  if (!dialog) return;
  renameTrigger = button;
  dialog.querySelector('#rename-original-filename').value = button.dataset.filename ?? '';
  dialog.querySelector('#rename-suffix').textContent = button.dataset.suffix ?? '';
  const input = dialog.querySelector('#rename-new-base');
  input.value = button.dataset.base ?? '';
  input.removeAttribute('aria-invalid');
  dialog.querySelector('#rename-error').textContent = '';
  dialog.showModal();
  input.select();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-compress]');
  if (!button) return;
  const dialog = document.getElementById('compress-dialog');
  if (!dialog) return;
  compressTrigger = button;
  dialog.querySelector('#compress-filename').value = button.dataset.filename ?? '';
  dialog.showModal();
  dialog.querySelector('input[name="format"]:checked')?.focus();
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-rename-cancel]')) closeRenameDialog();
  if (event.target.closest('[data-compress-cancel]')) closeCompressDialog();
});

document.getElementById('rename-dialog')?.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeRenameDialog();
});

document.getElementById('compress-dialog')?.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeCompressDialog();
});

document.querySelector('[data-compress-form]')?.addEventListener('htmx:beforeRequest', () => {
  operationTrigger = compressTrigger;
  closeCompressDialog(false);
});

document.querySelector('[data-rename-form]')?.addEventListener('submit', (event) => {
  if (!validateRenameForm()) event.preventDefault();
});

document.querySelector('[data-rename-form]')?.addEventListener('htmx:beforeRequest', (event) => {
  if (!validateRenameForm()) {
    event.preventDefault();
    return;
  }
  operationTrigger = renameTrigger;
  closeRenameDialog(false);
});

document.getElementById('rename-new-base')?.addEventListener('input', () => {
  const input = document.getElementById('rename-new-base');
  const error = document.getElementById('rename-error');
  input?.removeAttribute('aria-invalid');
  if (error) error.textContent = '';
});

function openOperationDialog() {
  const dialog = document.querySelector('[data-operation-dialog]');
  if (!dialog || dialog.open) return;
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.showModal();
  const focusTarget = dialog.dataset.operationStatus === 'running'
    ? dialog.querySelector('h2')
    : dialog.querySelector('.operation-dialog__ok');
  focusTarget?.focus();
}

function closeOperationDialog() {
  const dialog = document.querySelector('[data-operation-dialog]');
  if (dialog?.open) dialog.close();
  document.getElementById('operation-dialog-host')?.replaceChildren();
  operationTrigger?.focus();
  operationTrigger = null;
}

function closeConfirmation(restoreFocus = true) {
  const pending = pendingConfirmation;
  pendingConfirmation = null;
  const dialog = document.querySelector('[data-confirm-dialog]');
  if (dialog?.open) dialog.close();
  if (restoreFocus && pending?.trigger?.isConnected) pending.trigger.focus();
}

function acceptConfirmation() {
  const pending = pendingConfirmation;
  if (!pending) return;
  const acceptButton = document.querySelector('[data-confirm-accept]');
  if (acceptButton) acceptButton.disabled = true;
  closeConfirmation(false);
  pending.issueRequest(true);
}

document.addEventListener('htmx:confirm', (event) => {
  if (!event.detail.question) return;
  event.preventDefault();
  if (pendingConfirmation) return;

  const dialog = document.querySelector('[data-confirm-dialog]');
  const message = dialog?.querySelector('#confirm-dialog-message');
  const title = dialog?.querySelector('#confirm-dialog-title');
  const acceptButton = dialog?.querySelector('[data-confirm-accept]');
  const cancelButton = dialog?.querySelector('[data-confirm-cancel]');
  if (!dialog || !message || !title || !acceptButton || !cancelButton) return;

  const trigger = event.detail.elt;
  const metadata = trigger.closest('[data-confirm-title]') ?? trigger;
  const variant = metadata.dataset.confirmVariant ?? 'danger';
  const focusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
  pendingConfirmation = { trigger: focusTarget, issueRequest: event.detail.issueRequest };
  title.textContent = metadata.dataset.confirmTitle ?? clientMessage('confirmation.defaultTitle');
  message.textContent = event.detail.question;
  acceptButton.textContent = metadata.dataset.confirmAction ?? clientMessage('common.confirm');
  acceptButton.disabled = false;
  acceptButton.className = `button ${variant === 'warning' ? 'button--warning' : 'button--danger'}`;
  dialog.classList.toggle('operation--failed', variant === 'danger');
  dialog.classList.toggle('confirmation-dialog--warning', variant === 'warning');
  dialog.showModal();
  cancelButton.focus();
});

function showClientError(message) {
  const host = document.getElementById('operation-dialog-host');
  if (!host) return;
  host.innerHTML = `<dialog class="operation-dialog operation--failed" data-operation-dialog data-operation-status="failed" aria-labelledby="client-error-title"><div class="operation-dialog__header"><span class="status-dot" aria-hidden="true"></span><div><h2 id="client-error-title" tabindex="-1"></h2><p></p></div><span class="operation-dialog__state"></span></div><div class="operation-dialog__footer"><button class="button button--primary operation-dialog__ok" type="button" data-dialog-close></button></div></dialog>`;
  host.querySelector('h2').textContent = clientMessage('errors.operationFailedTitle');
  host.querySelector('p').textContent = message;
  host.querySelector('.operation-dialog__state').textContent = clientMessage('status.error');
  host.querySelector('button').textContent = clientMessage('common.ok');
  openOperationDialog();
}

document.addEventListener('htmx:beforeRequest', (event) => {
  const target = event.detail.target;
  if (target?.id === 'operation-dialog-host') operationTrigger = event.detail.elt;
});

document.addEventListener('htmx:beforeSwap', (event) => {
  if (event.detail.xhr.status >= 400) {
    event.detail.shouldSwap = true;
    event.detail.isError = false;
  }
});

document.addEventListener('htmx:afterSwap', (event) => {
  if (event.detail.target?.id === 'operation-dialog-host') {
    if (document.querySelector('[data-operation-dialog]')) openOperationDialog();
    else {
      operationTrigger?.focus();
      operationTrigger = null;
    }
  }
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-dialog-close]')) closeOperationDialog();
  if (event.target.closest('[data-confirm-cancel]')) closeConfirmation();
  if (event.target.closest('[data-confirm-accept]')) acceptConfirmation();
});

document.addEventListener('cancel', (event) => {
  if (!event.target.matches('[data-confirm-dialog]')) return;
  event.preventDefault();
  closeConfirmation();
}, true);

document.addEventListener('keydown', (event) => {
  const dialog = document.querySelector('[data-confirm-dialog]');
  if (event.key !== 'Escape' || !dialog?.open) return;
  event.preventDefault();
  event.stopPropagation();
  closeConfirmation();
}, true);

document.addEventListener('DOMContentLoaded', openOperationDialog);

const uploadForm = document.querySelector('form.upload');

if (uploadForm) {
  const fileInput = uploadForm.querySelector('input[type="file"]');
  const pickerText = uploadForm.querySelector('.file-picker__text');
  const progressContainer = uploadForm.querySelector('.upload-progress');
  const progress = uploadForm.querySelector('progress');
  const progressValue = uploadForm.querySelector('.upload-progress__value');

  fileInput.addEventListener('change', () => {
    if (!fileInput.files?.length) return;
    pickerText.textContent = clientMessage('client.upload.uploading');
    fileInput.style.pointerEvents = 'none';
    uploadForm.requestSubmit();
  });

  uploadForm.addEventListener('htmx:beforeRequest', () => {
    progress.value = 0;
    progress.textContent = formatPercent(0);
    progressValue.textContent = formatPercent(0);
    progressContainer.hidden = false;
    const host = document.getElementById('operation-dialog-host');
    if (host) {
      host.innerHTML = `<dialog class="operation-dialog operation--running" data-operation-dialog data-operation-status="running" aria-labelledby="upload-dialog-title"><div class="operation-dialog__header"><span class="status-dot" aria-hidden="true"></span><div><h2 id="upload-dialog-title" tabindex="-1"></h2><p></p></div><span class="operation-dialog__state"></span></div><div class="operation-progress"><span></span><strong data-upload-dialog-value></strong><progress data-upload-dialog-progress value="0" max="100"></progress></div><div class="operation-dialog__footer"><span></span></div></dialog>`;
      host.querySelector('h2').textContent = clientMessage('client.upload.dialogTitle');
      host.querySelector('.operation-dialog__header p').textContent = clientMessage('client.upload.dialogSummary');
      host.querySelector('.operation-dialog__state').textContent = clientMessage('status.running');
      host.querySelector('.operation-progress > span').textContent = clientMessage('operations.progress');
      host.querySelector('[data-upload-dialog-value]').textContent = formatPercent(0);
      host.querySelector('[data-upload-dialog-progress]').textContent = formatPercent(0);
      host.querySelector('.operation-dialog__footer span').textContent = clientMessage('operations.running.cannotClose');
      openOperationDialog();
    }
  });

  uploadForm.addEventListener('htmx:xhr:progress', (event) => {
    if (!event.detail.total) return;
    const percentage = Math.min(100, Math.round(event.detail.loaded / event.detail.total * 100));
    const formatted = formatPercent(percentage);
    progress.value = percentage;
    progress.textContent = formatted;
    progressValue.textContent = formatted;
    const dialogProgress = document.querySelector('[data-upload-dialog-progress]');
    const dialogValue = document.querySelector('[data-upload-dialog-value]');
    if (dialogProgress) dialogProgress.value = percentage;
    if (dialogValue) dialogValue.textContent = formatted;
  });

  uploadForm.addEventListener('htmx:afterRequest', () => {
    progressContainer.hidden = true;
    fileInput.style.pointerEvents = '';
    fileInput.value = '';
    pickerText.textContent = clientMessage('files.upload.choose');
  });
}

// Toggle between input (for new DB) and select (for existing DB) and validate overwrite consent.
document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form[hx-post="/operations/restore"]')
    || document.querySelector('form[action="/operations/restore"]');
  if (!form) return;

  const modeRadios = Array.from(form.querySelectorAll('input[name="targetMode"]'));
  const inputEl = document.getElementById('targetDatabaseInput');
  const selectEl = document.getElementById('targetDatabaseSelect');
  const datalist = document.getElementById('database-options');
  const allowOverwrite = form.querySelector('input[name="allowOverwrite"]');

  if (!inputEl || !selectEl || !datalist) return;

  // Populate select with databases from datalist
  function populateSelectFromDatalist() {
    const list = document.getElementById('database-options');
    if (!list) return;
    selectEl.innerHTML = '';
    for (const opt of Array.from(list.options)) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.value;
      selectEl.appendChild(o);
    }
  }
  populateSelectFromDatalist();

  // Re-populate when HTMX swaps content (including OOB swaps)
  document.addEventListener('htmx:afterSwap', () => populateSelectFromDatalist());
  document.addEventListener('htmx:oobAfterSwap', () => populateSelectFromDatalist());

  function showInput() {
    inputEl.style.display = '';
    inputEl.disabled = false;
    // when showing the free-text input for a new DB, remove the datalist
    // to avoid the native dropdown arrow/control on hover
    inputEl.removeAttribute('list');
    selectEl.style.display = 'none';
    selectEl.disabled = true;
    selectEl.setAttribute('aria-hidden', 'true');
    inputEl.setAttribute('aria-hidden', 'false');
  }

  function showSelect() {
    // restore datalist (kept for accessibility but not required when select shown)
    inputEl.setAttribute('list', 'database-options');
    selectEl.style.display = '';
    selectEl.disabled = false;
    inputEl.style.display = 'none';
    inputEl.disabled = true;
    inputEl.setAttribute('aria-hidden', 'true');
    selectEl.setAttribute('aria-hidden', 'false');
  }

  function updateUI() {
    const mode = form.querySelector('input[name="targetMode"]:checked')?.value ?? 'new';
    if (mode === 'existing') showSelect(); else showInput();
    // Default behavior: when choosing existing DB, pre-check overwrite consent.
    if (allowOverwrite) {
      if (mode === 'existing') allowOverwrite.checked = true;
      else allowOverwrite.checked = false;
    }
  }

  modeRadios.forEach((r) => r.addEventListener('change', updateUI));
  updateUI();

  // Client-side validation: require explicit overwrite consent when restoring to an existing DB
  if (allowOverwrite) {
    // For classic form submit
    form.addEventListener('submit', (ev) => {
      const mode = form.querySelector('input[name="targetMode"]:checked')?.value;
      if (mode === 'existing' && !allowOverwrite.checked) {
        ev.preventDefault();
        operationTrigger = ev.submitter ?? form;
        showClientError(clientMessage('validation.restoreOverwriteConsentRequired'));
      }
    });
    // For HTMX-driven requests
    form.addEventListener('htmx:beforeRequest', (ev) => {
      const mode = form.querySelector('input[name="targetMode"]:checked')?.value;
      if (mode === 'existing' && !allowOverwrite.checked) {
        ev.preventDefault();
        operationTrigger = ev.detail?.elt ?? form;
        showClientError(clientMessage('validation.restoreOverwriteConsentRequired'));
      }
    });
  }
});