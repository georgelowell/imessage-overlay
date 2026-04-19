/**
 * app.js
 *
 * Main controller. Wires together the DOM, Parser, Renderer, and Recorder.
 *
 * Responsibilities:
 *   - Handle video or image file upload → size canvas to 9:16
 *   - Read UI options (counterparty, time override, script, Ken Burns, etc.)
 *   - On "Preview": parse script, build renderer, start playback
 *   - On "Export": attach recorder to renderer, run, download file
 *   - On "Stop": halt everything cleanly
 */

(function () {

  // ── Custom emoji registry ────────────────────────────────────────────
  // Maps emoji name → { src, label } for the picker and renderer.
  // Add new entries here to register additional custom emoji images.
  const CUSTOM_EMOJI_DEFS = [
    { name: 'bull_chef', src: 'assets/images/bull_chef.png', label: 'Bull Chef' },
  ];

  // Pre-load HTMLImageElements so the renderer can draw them immediately.
  const _emojiImages = {};
  for (const def of CUSTOM_EMOJI_DEFS) {
    const img = new Image();
    img.src = def.src;
    _emojiImages[def.name] = img;
  }

  // ── DOM refs ────────────────────────────────────────────────────────
  const bgTabVideo         = document.getElementById('bgTabVideo');
  const bgTabImage         = document.getElementById('bgTabImage');
  const videoUploadWrap    = document.getElementById('videoUploadWrap');
  const imageUploadWrap    = document.getElementById('imageUploadWrap');
  const videoUpload        = document.getElementById('videoUpload');
  const imageUpload        = document.getElementById('imageUpload');
  const kenBurnsChk        = document.getElementById('kenBurns');
  const kenBurnsOptions    = document.getElementById('kenBurnsOptions');
  const kbZoomSelect       = document.getElementById('kbZoom');
  const kbPanSelect        = document.getElementById('kbPan');
  const imageDurationInput = document.getElementById('imageDuration');
  const settingsToggle     = document.getElementById('settingsToggle');
  const settingsBody       = document.getElementById('settingsBody');
  const settingsChevron    = document.getElementById('settingsChevron');
  const showHeader         = document.getElementById('showHeader');
  const headerOptions      = document.getElementById('headerOptions');
  const showCounterparty   = document.getElementById('showCounterparty');
  const counterpartyOpts   = document.getElementById('counterpartyOptions');
  const cpInitials         = document.getElementById('counterpartyInitials');
  const cpName             = document.getElementById('counterpartyName');
  const cpColor            = document.getElementById('counterpartyColor');
  const cpAvatarImageInput = document.getElementById('cpAvatarImage');
  const contactName        = document.getElementById('contactName');
  const statusTime         = document.getElementById('statusTime');
  const scrimOpacity       = document.getElementById('scrimOpacity');
  const scrimOpacityValue  = document.getElementById('scrimOpacityValue');
  const bgVolume           = document.getElementById('bgVolume');
  const bgVolumeValue      = document.getElementById('bgVolumeValue');
  const initialDelay       = document.getElementById('initialDelay');
  const btnAddNear         = document.getElementById('btnAddNear');
  const btnAddFar          = document.getElementById('btnAddFar');
  const bubbleList         = document.getElementById('bubbleList');
  const btnPreview         = document.getElementById('btnPreview');
  const btnExport          = document.getElementById('btnExport');
  const btnStop            = document.getElementById('btnStop');
  const exportStatus       = document.getElementById('exportStatus');
  const exportProgress     = document.getElementById('exportProgress');
  const exportLabel        = document.getElementById('exportLabel');
  const canvas             = document.getElementById('mainCanvas');
  const placeholder        = document.getElementById('placeholder');
  const sourceVideo        = document.getElementById('sourceVideo');

  // ── State ────────────────────────────────────────────────────────────
  let bgMode         = 'video';  // 'video' | 'image'
  let videoReady     = false;
  let imageReady     = false;
  let _uiMode        = 'idle';
  let activeRenderer = null;
  let activeRecorder = null;
  let _cpAvatarImg   = null;   // HTMLImageElement for counterparty avatar (or null)

  // ── Bubble builder state ─────────────────────────────────────────────
  let bubbles                 = [];
  let nextBubbleId            = 1;
  let _lastFocusedBubbleInput = null;
  let _drag                   = null;

  // Image element used as texture source in image mode
  const bgImage = new Image();

  // ── Background mode tabs ─────────────────────────────────────────────

  document.querySelectorAll('input[name="bgType"]').forEach(radio => {
    radio.addEventListener('change', e => {
      bgMode = e.target.value;
      _updateBgModeUI();
      _refreshButtons();
    });
  });

  function _updateBgModeUI() {
    const isImage = bgMode === 'image';
    bgTabVideo.classList.toggle('active', !isImage);
    bgTabImage.classList.toggle('active', isImage);
    videoUploadWrap.classList.toggle('hidden', isImage);
    imageUploadWrap.classList.toggle('hidden', !isImage);
  }

  // ── Video upload ─────────────────────────────────────────────────────

  videoUpload.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    sourceVideo.src = url;
    sourceVideo.load();

    sourceVideo.addEventListener('loadedmetadata', () => {
      _sizeCanvas(sourceVideo.videoWidth, sourceVideo.videoHeight);
      videoReady = true;
      placeholder.classList.add('hidden');
      _refreshButtons();
    }, { once: true });
  });

  // ── Image upload ─────────────────────────────────────────────────────

  imageUpload.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    bgImage.onload = () => {
      _sizeCanvasFromImage(bgImage);
      imageReady = true;
      placeholder.classList.add('hidden');
      _refreshButtons();
    };
    bgImage.src = url;
  });

  /**
   * Size the canvas to a 9:16 center-crop of the video.
   * Crops the minimum amount necessary to reach 9:16, then scales up
   * to a minimum of 1080×1920 so Instagram doesn't upscale a low-res source.
   */
  function _sizeCanvas(vw, vh) {
    const TARGET = 9 / 16;
    const MIN_W  = 1080;
    const videoRatio = vw / vh;

    let cropW, cropH;
    if (videoRatio > TARGET) {
      // Video is wider than 9:16 — use full height, crop width
      cropH = vh;
      cropW = Math.round(vh * TARGET);
    } else {
      // Video is taller than 9:16 — use full width, crop height
      cropW = vw;
      cropH = Math.round(vw / TARGET);
    }

    // Scale up if source is below 1080px wide (Instagram minimum)
    if (cropW < MIN_W) {
      cropH = Math.round(MIN_W / TARGET);
      cropW = MIN_W;
    }

    _applyCanvasSize(cropW, cropH);
  }

  /**
   * Size the canvas from an image, cropped to 9:16, capped at 1080×1920.
   */
  function _sizeCanvasFromImage(img) {
    const TARGET  = 9 / 16;
    const MAX_H   = 1920;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;

    let cropW, cropH;
    if (iw / ih > TARGET) {
      cropH = ih;
      cropW = Math.round(ih * TARGET);
    } else {
      cropW = iw;
      cropH = Math.round(iw / TARGET);
    }

    // Cap at 1080×1920 to avoid enormous canvases
    if (cropH > MAX_H) {
      cropW = Math.round(cropW * MAX_H / cropH);
      cropH = MAX_H;
    }

    _applyCanvasSize(cropW, cropH);
  }

  function _applyCanvasSize(cropW, cropH) {
    canvas.width  = cropW;
    canvas.height = cropH;

    // Scale canvas element to fit in the preview area
    const areaW = document.getElementById('previewArea').clientWidth  - 40;
    const areaH = document.getElementById('previewArea').clientHeight - 40;
    const ratio = Math.min(areaW / cropW, areaH / cropH, 1);

    canvas.style.width  = Math.round(cropW * ratio) + 'px';
    canvas.style.height = Math.round(cropH * ratio) + 'px';
    const wrap = document.getElementById('canvasWrap');
    wrap.style.width    = canvas.style.width;
    wrap.style.height   = canvas.style.height;
  }

  // ── Counterparty avatar image upload ────────────────────────────────

  cpAvatarImageInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) { _cpAvatarImg = null; return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { _cpAvatarImg = img; };
    img.src = url;
  });

  // ── Custom emoji picker ──────────────────────────────────────────────

  const customEmojiToggle  = document.getElementById('customEmojiToggle');
  const customEmojiPicker  = document.getElementById('customEmojiPicker');

  // Populate picker with all registered custom emoji
  for (const def of CUSTOM_EMOJI_DEFS) {
    const btn = document.createElement('button');
    btn.className = 'custom-emoji-btn';
    btn.title     = def.label;

    const img = document.createElement('img');
    img.src = def.src;
    img.alt = def.label;
    btn.appendChild(img);

    const lbl = document.createElement('span');
    lbl.textContent = def.label;
    btn.appendChild(lbl);

    btn.addEventListener('click', () => {
      _insertEmoji(`[emoji:${def.name}]`);
      customEmojiPicker.classList.add('hidden');
      customEmojiToggle.classList.remove('active');
    });
    customEmojiPicker.appendChild(btn);
  }

  customEmojiToggle.addEventListener('click', () => {
    const isHidden = customEmojiPicker.classList.contains('hidden');
    // Close standard picker if open
    if (isHidden) {
      emojiPicker.classList.add('hidden');
      emojiToggle.classList.remove('active');
    }
    customEmojiPicker.classList.toggle('hidden', !isHidden);
    customEmojiToggle.classList.toggle('active', isHidden);
  });

  // ── Standard emoji picker ─────────────────────────────────────────────

  const EMOJI_CATEGORIES = [
    { label: '😊', name: 'Smileys', emojis: ['😀','😁','😂','🤣','😊','😍','🥰','😘','🥹','😎','🤩','🥳','😅','😭','😤','😡','🤔','🤗','😴','🤑','😬','🙄','😱','😰','🫡','🥺','😏','😒','😔','😞','😣','😫','😩','🥱','🤯','🤠','🥸','🤡','👻','💀'] },
    { label: '👍', name: 'Gestures', emojis: ['👍','👎','👏','🙌','🤝','🫶','🙏','👋','🤞','✌️','🤙','💪','🫂','🤜','🤛','👊','✊','🤚','👐','🫴','🫵','☝️','👆','👇','👈','👉','🖖','🤘','🤟'] },
    { label: '❤️', name: 'Hearts', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','❤️‍🔥','❤️‍🩹','🫀'] },
    { label: '🔥', name: 'Symbols', emojis: ['🔥','💯','✅','❌','⭐','🌟','💫','✨','🎉','🎊','🏆','🥇','🎯','💎','👑','🚀','💸','💰','📱','💻','🎵','🎶','📸','🌈','☀️','🌙','🌊','🌺','🍀','🎁','🌿','🪴','🚬'] },
    { label: '🍕', name: 'Food', emojis: ['🍕','🍔','🍟','🌮','🌯','🍜','🍣','🍦','🎂','🍰','🧁','🍩','🍪','☕','🧃','🍺','🥂','🍾','🥤','🧋','🍷','🫖'] },
    { label: '😸', name: 'Animals', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦉','🐺','🦋','🐝','🐙','🦈','🐬','🦭'] },
  ];

  const emojiToggle  = document.getElementById('emojiToggle');
  const emojiPicker  = document.getElementById('emojiPicker');
  const emojiTabs    = document.getElementById('emojiTabs');
  const emojiGrid    = document.getElementById('emojiGrid');

  // Build tabs
  EMOJI_CATEGORIES.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className   = 'emoji-tab' + (i === 0 ? ' active' : '');
    btn.textContent = cat.label;
    btn.title       = cat.name;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      _renderEmojiGrid(cat.emojis);
    });
    emojiTabs.appendChild(btn);
  });

  function _renderEmojiGrid(emojis) {
    emojiGrid.innerHTML = '';
    emojis.forEach(em => {
      const btn = document.createElement('button');
      btn.className   = 'emoji-btn';
      btn.textContent = em;
      btn.addEventListener('click', () => _insertEmoji(em));
      emojiGrid.appendChild(btn);
    });
  }

  function _insertEmoji(emoji) {
    const input = _lastFocusedBubbleInput;
    if (!input) return;
    const start = input.selectionStart;
    const end   = input.selectionEnd;
    const val   = input.value;
    input.value = val.slice(0, start) + emoji + val.slice(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
    // Sync to bubble data
    const card = input.closest('.bubble-card[data-id]');
    if (card) {
      const id = parseInt(card.dataset.id);
      const b  = bubbles.find(b => b.id === id);
      if (b) b.text = input.value;
    }
  }

  // Toggle picker open/closed (close custom picker if open)
  emojiToggle.addEventListener('click', () => {
    const isHidden = emojiPicker.classList.contains('hidden');
    if (isHidden) {
      customEmojiPicker.classList.add('hidden');
      customEmojiToggle.classList.remove('active');
    }
    emojiPicker.classList.toggle('hidden', !isHidden);
    emojiToggle.classList.toggle('active', isHidden);
  });

  // Render first category on load
  _renderEmojiGrid(EMOJI_CATEGORIES[0].emojis);

  // ── Bubble builder ───────────────────────────────────────────────────

  btnAddNear.addEventListener('click', () => _addBubble('near'));
  btnAddFar.addEventListener('click',  () => _addBubble('far'));

  function _addBubble(side) {
    bubbles.push({ id: nextBubbleId++, side, text: '', typing: 0, delay: 0 });
    _renderBubbles();
    // Focus the new bubble's textarea
    const cards = bubbleList.querySelectorAll('.bubble-card');
    const last  = cards[cards.length - 1];
    if (last) last.querySelector('.bubble-text-input').focus();
  }

  function _renderBubbles() {
    bubbleList.innerHTML = '';
    if (bubbles.length === 0) {
      const el = document.createElement('p');
      el.className   = 'bubble-list-empty';
      el.textContent = 'Press + Near or + Far to add a message bubble.';
      bubbleList.appendChild(el);
      return;
    }
    bubbles.forEach(b => bubbleList.appendChild(_makeBubbleCard(b)));
  }

  function _makeBubbleCard(bubble) {
    const card = document.createElement('div');
    card.className  = `bubble-card ${bubble.side}`;
    card.dataset.id = bubble.id;

    card.innerHTML = `
      <div class="bubble-card-header">
        <span class="bubble-drag-handle" title="Drag to reorder">⠿</span>
        <span class="bubble-label ${bubble.side}">${bubble.side === 'near' ? 'Near' : 'Far'}</span>
        <button class="bubble-delete" title="Remove" type="button">×</button>
      </div>
      <textarea class="bubble-text-input" placeholder="Message text…" rows="2"></textarea>
      <div class="bubble-timing-row">
        <div class="bubble-timing-field">
          <span class="bubble-timing-label">Typing (s)</span>
          <input type="number" class="bubble-typing" min="0" max="30" step="0.5" placeholder="0" />
        </div>
        <div class="bubble-timing-field">
          <span class="bubble-timing-label">Delay after (s)</span>
          <input type="number" class="bubble-delay" min="0" max="30" step="0.5" placeholder="0" />
        </div>
      </div>
    `;

    const textarea  = card.querySelector('.bubble-text-input');
    const typingInp = card.querySelector('.bubble-typing');
    const delayInp  = card.querySelector('.bubble-delay');
    const deleteBtn = card.querySelector('.bubble-delete');
    const handle    = card.querySelector('.bubble-drag-handle');

    // Restore values from bubble data (e.g. after re-render from drag)
    textarea.value  = bubble.text;
    typingInp.value = bubble.typing > 0 ? bubble.typing : '';
    delayInp.value  = bubble.delay  > 0 ? bubble.delay  : '';

    textarea.addEventListener('focus', () => { _lastFocusedBubbleInput = textarea; });
    textarea.addEventListener('input', () => { bubble.text    = textarea.value; });
    typingInp.addEventListener('input', () => { bubble.typing = parseFloat(typingInp.value) || 0; });
    delayInp.addEventListener('input',  () => { bubble.delay  = parseFloat(delayInp.value)  || 0; });

    deleteBtn.addEventListener('click', () => {
      bubbles = bubbles.filter(b => b.id !== bubble.id);
      _renderBubbles();
    });

    _initDrag(card, handle, bubble.id);

    return card;
  }

  function _getBubbleScript() {
    return bubbles.map(b => {
      const side = b.side === 'near' ? 'A' : 'B';
      const text = b.text.trim() || '…';
      const d = b.delay  > 0 ? b.delay  : 0;
      const t = b.typing > 0 ? b.typing : 0;
      let bracket = '';
      if (d > 0 && t > 0) bracket = ` [d:${d},t:${t}]`;
      else if (d > 0)     bracket = ` [d:${d}]`;
      else if (t > 0)     bracket = ` [t:${t}]`;
      return `${side}: ${text}${bracket}`;
    }).join('\n');
  }

  // ── Drag & drop reordering ────────────────────────────────────────────

  function _initDrag(card, handle, id) {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      const rect = card.getBoundingClientRect();

      const ghost = card.cloneNode(true);
      Object.assign(ghost.style, {
        position:      'fixed',
        left:          rect.left + 'px',
        top:           rect.top  + 'px',
        width:         rect.width + 'px',
        opacity:       '0.9',
        zIndex:        '9999',
        pointerEvents: 'none',
        transform:     'scale(1.02)',
        boxShadow:     '0 8px 24px rgba(0,0,0,0.5)',
        transition:    'none',
      });
      document.body.appendChild(ghost);
      card.style.opacity = '0.3';

      _drag = { id, card, ghost, offsetY: e.clientY - rect.top, overId: null };
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', e => {
      if (!_drag || _drag.id !== id) return;
      _drag.ghost.style.top = (e.clientY - _drag.offsetY) + 'px';

      // Temporarily hide ghost to hit-test the card beneath
      _drag.ghost.style.visibility = 'hidden';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      _drag.ghost.style.visibility = '';

      const overCard = el && el.closest('.bubble-card[data-id]');
      bubbleList.querySelectorAll('.bubble-card').forEach(c => c.classList.remove('drag-over'));
      if (overCard && overCard !== card) {
        overCard.classList.add('drag-over');
        _drag.overId = parseInt(overCard.dataset.id);
      } else {
        _drag.overId = null;
      }
    });

    handle.addEventListener('pointerup', () => {
      if (!_drag || _drag.id !== id) return;

      _drag.ghost.remove();
      _drag.card.style.opacity = '';
      bubbleList.querySelectorAll('.bubble-card').forEach(c => c.classList.remove('drag-over'));

      const { overId } = _drag;
      _drag = null;

      if (overId !== null) {
        const fromIdx = bubbles.findIndex(b => b.id === id);
        const toIdx   = bubbles.findIndex(b => b.id === overId);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          const [removed] = bubbles.splice(fromIdx, 1);
          bubbles.splice(toIdx, 0, removed);
          _renderBubbles();
        }
      }
    });
  }

  // ── Settings dropdown toggle ─────────────────────────────────────────

  settingsToggle.addEventListener('click', () => {
    const isOpen = !settingsBody.classList.contains('hidden');
    settingsBody.classList.toggle('hidden', isOpen);
    settingsChevron.classList.toggle('open', !isOpen);
  });

  // ── Header toggle ────────────────────────────────────────────────────

  showHeader.addEventListener('change', () => {
    headerOptions.classList.toggle('hidden', !showHeader.checked);
  });

  // ── Scrim opacity display ────────────────────────────────────────────

  scrimOpacity.addEventListener('input', () => {
    scrimOpacityValue.textContent = scrimOpacity.value + '%';
  });

  // ── Background audio volume ──────────────────────────────────────────

  bgVolume.addEventListener('input', () => {
    bgVolumeValue.textContent = bgVolume.value + '%';
    sourceVideo.volume = parseInt(bgVolume.value, 10) / 100;
  });

  // Set initial volume on page load
  sourceVideo.volume = parseInt(bgVolume.value, 10) / 100;

  // ── Counterparty toggle ──────────────────────────────────────────────

  showCounterparty.addEventListener('change', () => {
    counterpartyOpts.classList.toggle('hidden', !showCounterparty.checked);
  });

  // ── Ken Burns sub-options toggle ─────────────────────────────────────

  kenBurnsChk.addEventListener('change', () => {
    kenBurnsOptions.classList.toggle('hidden', !kenBurnsChk.checked);
  });

  // ── Collect options ──────────────────────────────────────────────────

  function _getOptions() {
    return {
      scale:            1,
      showHeader:       showHeader.checked,
      contactName:      contactName.value.trim() || 'iPhone',
      statusTime:       statusTime.value.trim() || null,
      scrimOpacity:     parseInt(scrimOpacity.value, 10) / 100,
      initialDelay:     parseFloat(initialDelay.value) || 0,
      showCounterparty: showCounterparty.checked,
      cpInitials:       cpInitials.value.trim() || 'JD',
      cpName:           cpName.value.trim()     || 'John',
      cpColor:          cpColor.value,
      cpAvatarImage:    _cpAvatarImg,
      emojiImages:      _emojiImages,
      // Background
      bgMode:           bgMode,
      bgImage:          bgMode === 'image' ? bgImage : null,
      kenBurns:         kenBurnsChk.checked,
      kbZoom:           kbZoomSelect.value,
      kbPan:            kbPanSelect.value,
      imageDuration:    parseFloat(imageDurationInput.value) || 30,
    };
  }

  // ── Check if media is ready ───────────────────────────────────────────

  function _mediaReady() {
    return (bgMode === 'video' && videoReady) || (bgMode === 'image' && imageReady);
  }

  function _refreshButtons() {
    if (_uiMode === 'idle') {
      btnExport.disabled = !_mediaReady();
    }
  }

  // ── Preview ──────────────────────────────────────────────────────────

  btnPreview.addEventListener('click', () => {
    AudioEngine.warmUp();
    if (!_mediaReady()) {
      alert(bgMode === 'video' ? 'Please upload a video first.' : 'Please upload an image first.');
      return;
    }

    if (bubbles.length === 0) {
      alert('Add at least one message bubble.');
      return;
    }
    const script = _getBubbleScript();

    _stopAll();

    let timeline;
    try {
      timeline = Parser.parseScript(script);
    } catch (err) {
      alert('Script parse error: ' + err.message);
      return;
    }

    if (timeline.length === 0) {
      alert('No events found in script. Check your syntax.');
      return;
    }

    const opts = _getOptions();
    activeRenderer = new Renderer(canvas, sourceVideo, timeline, opts);
    activeRenderer.onEnd = () => {
      _setMode('idle');
    };

    _setMode('playing');
    activeRenderer.start();
  });

  // ── Export ───────────────────────────────────────────────────────────

  btnExport.addEventListener('click', () => {
    AudioEngine.warmUp();
    if (!_mediaReady()) {
      alert(bgMode === 'video' ? 'Please upload a video first.' : 'Please upload an image first.');
      return;
    }

    if (bubbles.length === 0) {
      alert('Add at least one message bubble.');
      return;
    }
    const script = _getBubbleScript();

    _stopAll();

    let timeline;
    try {
      timeline = Parser.parseScript(script);
    } catch (err) {
      alert('Script parse error: ' + err.message);
      return;
    }

    const opts = _getOptions();

    // Duration: use imageDuration for image mode; derive from timeline for video mode
    let duration;
    if (opts.bgMode === 'image') {
      duration = opts.imageDuration;
    } else {
      const last = timeline[timeline.length - 1];
      duration = last ? last.endTime + 2 : 10;
    }

    // Start routing Web Audio API sounds into a capture stream before MediaRecorder starts
    const audioStream = AudioEngine.startRecording();

    activeRenderer = new Renderer(canvas, sourceVideo, timeline, opts);
    activeRecorder = new Recorder(canvas, {
      fps:          30,
      videoBitrate: 8_000_000,
      duration,
      audioStream,
      onProgress: ratio => {
        exportProgress.value = Math.round(ratio * 100);
        exportLabel.textContent = `Exporting… ${Math.round(ratio * 100)}%`;
      },
      onConvertStart: () => {
        // FFmpeg core is ~25 MB and downloads once; show a loading state
        exportProgress.value = 0;
        exportLabel.textContent = 'Loading FFmpeg… (first export only)';
      },
      onConvertProgress: ratio => {
        exportProgress.value = Math.round(ratio * 100);
        exportLabel.textContent = `Converting to MP4… ${Math.round(ratio * 100)}%`;
      },
      onConvertError: err => {
        // Surface the real error so it's diagnosable
        const msg = err && err.message ? err.message : String(err);
        console.error('[Export] FFmpeg failed:', err);
        alert(`MP4 conversion failed — downloading as WebM instead.\n\nError: ${msg}`);
      },
    });

    activeRecorder.onStop = (url, ext) => {
      AudioEngine.stopRecording();
      Recorder.download(url, ext, 'imessage-overlay');
      exportLabel.textContent = ext === 'mp4' ? 'Export complete!' : 'Saved as WebM (MP4 conversion failed).';
      // Keep status visible briefly before hiding
      setTimeout(() => {
        _setMode('idle');
        setTimeout(() => exportStatus.classList.add('hidden'), 100);
      }, 2500);
    };

    activeRenderer.onEnd = () => {
      // Give recorder a moment to flush
      setTimeout(() => {
        activeRecorder.stop();
      }, 500);
    };

    _setMode('exporting');
    activeRecorder.start();
    activeRenderer.start();
  });

  // ── Stop ─────────────────────────────────────────────────────────────

  btnStop.addEventListener('click', () => {
    _stopAll();
    _setMode('idle');
  });

  function _stopAll() {
    if (activeRenderer) {
      activeRenderer.stop();
      activeRenderer = null;
    }
    if (activeRecorder) {
      AudioEngine.stopRecording();  // disconnect audio capture routing (idempotent)
      activeRecorder.stop();
      activeRecorder = null;
    }
  }

  // ── UI state machine ─────────────────────────────────────────────────

  /**
   * @param {'idle'|'playing'|'exporting'} mode
   */
  function _setMode(mode) {
    _uiMode = mode;
    btnPreview.disabled = (mode !== 'idle');
    btnExport.disabled  = (mode !== 'idle') || !_mediaReady();
    btnStop.hidden      = (mode === 'idle');

    if (mode === 'exporting') {
      exportStatus.classList.remove('hidden');
      exportProgress.value = 0;
      exportLabel.textContent = 'Exporting…';
    } else {
      if (mode === 'idle') {
        exportStatus.classList.add('hidden');
      }
    }
  }

  // ── Keyboard shortcut ────────────────────────────────────────────────

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      _stopAll();
      _setMode('idle');
    }
  });

  // ── Init ─────────────────────────────────────────────────────────────

  _setMode('idle');
  btnExport.disabled = true;   // needs media first
  _renderBubbles();

  console.log('[app] iMessage Overlay ready.');

})();
