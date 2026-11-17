(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const app = $('#app');
  const toastNode = $('#toast');
  const STORAGE_KEY = 'foundation-amount-game-v1';
  const SCORE_CONFIG = {
    targetLiquid: 5,       // 액상 파운데이션의 기준 양(펌프 단위)
    targetCushion: 5,      // 쿠션 기준 양(초기 밸런스 값, 필요 시 조정)
    quantityTolerance: 12, // 기준 양에서 벗어날 때의 감점 폭
    timeReferenceSeconds: 180,
    liquidMultiplier: 0.85,
    cushionMultiplier: 0.85,
    stickMultiplier: 1.00
  };
  const PRODUCTS = {
    liquid: { name: '리퀴드 파운데이션', emoji: '🧴', desc: '펌프 양을 조절하고 스파출러와 퍼프로 얇게 밀착해 봐요.' },
    cushion: { name: '쿠션 파운데이션', emoji: '🩷', desc: '퍼프에 묻는 양을 조절해 자연스럽게 두드려 발라봐요.' },
    stick: { name: '스틱 파운데이션', emoji: '💄', desc: '양 볼에 바르는 횟수를 조절하고 브러시로 블렌딩해요.' }
  };
  const BLEMISH_POINTS = [
    [34.0, 56.2], [37.0, 54.7], [38.2, 57.3], [40.1, 55.8], [36.4, 59.0],
    [60.0, 55.8], [62.0, 57.1], [64.0, 55.1], [61.5, 59.1], [65.0, 58.2],
    [45.0, 61.0], [55.0, 61.7]
  ];

  const emptyState = {
    screen: 'home',
    skin: { darkCircles: false, blemishes: false, texture: false },
    hasConfiguredSkin: false,
    nickname: '',
    localRecords: [],
    session: null,
    result: null,
    saving: false,
    rankingRows: []
  };
  let state = loadState();
  let timerHandle = null;
  let scoreAnimationHandle = null;
  let toastHandle = null;
  let revealNextScreen = 'home';
  let supabaseClient = null;
  let backendConfigured = Boolean(window.APP_CONFIG?.supabaseUrl && window.APP_CONFIG?.supabaseAnonKey);
  let supabaseUser = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        ...emptyState,
        ...saved,
        skin: { ...emptyState.skin, ...(saved.skin || {}) },
        localRecords: Array.isArray(saved.localRecords) ? saved.localRecords : []
      };
    } catch (_) { return { ...emptyState }; }
  }

  function persist() {
    const data = {
      skin: state.skin,
      hasConfiguredSkin: state.hasConfiguredSkin,
      nickname: state.nickname,
      localRecords: state.localRecords.slice(0, 30)
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) { showToast('저장 공간이 부족해요.'); }
  }

  function setSaveState(message) {
    const node = $('#save-state');
    if (node) node.textContent = message;
  }

  function showToast(message) {
    toastNode.textContent = message;
    toastNode.classList.add('show');
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => toastNode.classList.remove('show'), 2400);
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function characterHTML(options = {}) {
    const mode = options.mode || 'normal';
    const product = options.product || null;
    const quantity = Number(options.quantity || 0);
    const strokes = Number(options.strokes || 0);
    const animate = Boolean(options.animate);
    const showMarks = Boolean(options.showMarks);
    const hasSkin = options.skin || state.skin;
    let imperfectionOpacity = 1;
    let foundationOpacity = 0;
    let cakeyOpacity = 0;
    if (mode === 'applying') {
      const activeAmount = product === 'stick' ? Math.min(1, strokes / 8) : Math.min(1, quantity / 8);
      foundationOpacity = 0.10 + activeAmount * 0.25;
      if (product !== 'stick') cakeyOpacity = Math.min(.25, Math.max(0, quantity - 5) * .025);
    }
    if (mode === 'final') {
      if (product === 'liquid') imperfectionOpacity = 0.52;
      else if (product === 'cushion') imperfectionOpacity = 0.62;
      else imperfectionOpacity = 0;
      const amountScore = product === 'stick' ? Math.min(1, strokes / 4) : Math.min(1, quantity / 5);
      foundationOpacity = product === 'stick' ? 0.38 : 0.10 + amountScore * 0.20;
      if (product !== 'stick') cakeyOpacity = Math.min(.38, Math.max(0, quantity - 5) * .035);
    }
    const style = `--imperfection-opacity:${imperfectionOpacity};--texture-opacity:${hasSkin.texture ? .82 * imperfectionOpacity : 0};--foundation-opacity:${foundationOpacity};--cakey-opacity:${cakeyOpacity}`;
    const blemishes = hasSkin.blemishes ? BLEMISH_POINTS.map(([x,y]) => `<i class="blemish" style="left:${x}%;top:${y}%"></i>`).join('') : '';
    const marks = showMarks && strokes > 0 ? `<div class="application-marks">${Array.from({length: Math.min(strokes, 12)}, (_, i) => `<i class="stroke left" style="top:${48 + i*1.35}%;opacity:${Math.max(.22,.85-i*.045)}"></i><i class="stroke right" style="top:${48 + i*1.35}%;opacity:${Math.max(.22,.85-i*.045)}"></i>`).join('')}</div>` : '';
    return `<div class="character-frame ${animate ? 'is-applying' : ''}" style="${style}">
      <img class="character-base" src="assets/character.png" alt="기본 캐릭터" />
      <div class="skin-layer">
        ${hasSkin.darkCircles ? '<i class="dark-circle left"></i><i class="dark-circle right"></i>' : ''}
        ${blemishes}
      </div>
      <div class="texture-layer"></div>
      <div class="foundation-layer"></div>
      <div class="cakey-layer"></div>
      ${marks}
    </div>`;
  }

  function renderHome() {
    const nudge = !state.hasConfiguredSkin;
    app.innerHTML = `<section class="screen">
      <div class="hero">
        <span class="eyebrow">✦ 나만의 뷰티 연습실 ✦</span>
        <h1>오늘의 파운데이션<br><em>양조절</em></h1>
        <p class="subtitle">내 피부에 딱 맞는 양을 찾아보자! ♡</p>
        <div class="hero-character">${characterHTML({ mode: 'normal' })}</div>
        <div class="hero-actions">
          <button class="btn btn-primary" data-action="practice">양조절 연습하기 ✨</button>
          <button class="btn btn-secondary ${nudge ? 'setup-nudge' : ''}" data-action="open-skin">나의 피부 설정</button>
          ${nudge ? '<p class="helper-text">잠깐! 먼저 나와 비슷한 피부를 설정해 주세요! ♡</p>' : ''}
          <button class="btn btn-soft" data-action="ranking">양조절 랭킹 TOP 30 🏆</button>
        </div>
      </div>
    </section>`;
    setSaveState(backendConfigured ? 'Supabase 설정됨' : '이 기기에 저장');
  }

  function renderSkinSettings() {
    const labels = [
      ['darkCircles', '다크서클', '눈 밑 그늘을 자연스럽게 표현해요.'],
      ['blemishes', '잡티', '볼과 얼굴 일부에 작은 잡티를 더해요.'],
      ['texture', '울퉁불퉁한 피부 결', '은은한 요철 텍스처를 표현해요.']
    ];
    app.innerHTML = `<section class="screen">
      <div class="section-head"><span class="eyebrow">♡ 나의 피부 ♡</span><h1>나의 피부 설정</h1><p>평소 내 피부와 비슷하게 골라주세요.<br>세 가지 설정은 각각 따로 켜고 끌 수 있어요.</p></div>
      <div class="skin-layout">
        <div class="skin-preview panel">${characterHTML()}</div>
        <div class="skin-controls panel">
          <h3>어떤 피부 고민이 있나요?</h3>
          ${labels.map(([key,title,desc]) => `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><small>${desc}</small></div><button class="toggle" role="switch" aria-checked="${state.skin[key]}" aria-label="${title}" data-action="skin-toggle" data-key="${key}"></button></div>`).join('')}
          <p class="helper-text">선택한 피부 상태는 연습을 시작할 때 반영돼요. 언제든 다시 수정할 수 있어요.</p>
          <div class="actions-row"><button class="btn btn-secondary btn-small" data-action="home">취소</button><button class="btn btn-primary btn-small" data-action="skin-save">설정 완료 ♡</button></div>
        </div>
      </div>
    </section>`;
  }

  function renderReveal() {
    app.innerHTML = `<section class="screen reveal" style="text-align:center;padding:24px 0"><span class="eyebrow">✦ 캐릭터 완성 ✦</span><h1 style="font-size:30px;margin:15px 0 8px">나만의 피부 설정 완료! ♡</h1><p class="subtitle">이제 내 피부에 맞는 양을 찾아봐요.</p><div style="width:min(76vw,340px);margin:15px auto">${characterHTML()}</div><div class="reveal-hearts">♥ ✦ ♥ ✦ ♥</div><button class="btn btn-primary" data-action="reveal-continue">시작하기</button></section>`;
  }

  function renderProductSelect() {
    app.innerHTML = `<section class="screen">
      <div class="section-head"><span class="eyebrow">✦ 연습 시작 ✦</span><h1>어떤 파운데이션으로<br>연습할까요?</h1><p>제품마다 양을 조절하는 방법이 달라요.<br>하나씩 도전해 보세요!</p></div>
      <div class="product-grid">${Object.entries(PRODUCTS).map(([key,p]) => `<article class="product-card"><div class="product-visual">${p.emoji}</div><h3>${p.name}</h3><p>${p.desc}</p><button class="btn btn-primary btn-small" data-action="select-product" data-product="${key}">연습 시작하기</button></article>`).join('')}</div>
      <div style="text-align:center;margin-top:17px"><button class="btn btn-secondary btn-small" data-action="home">메인으로 돌아가기</button></div>
    </section>`;
  }

  function amountDots(amount) {
    const count = Math.min(24, Math.max(0, Math.round(amount)));
    return count ? Array.from({length: count}, () => '<i class="amount-dot"></i>').join('') : '<span class="amount-empty">아직 준비된 양이 없어요</span>';
  }

  function renderTraining() {
    const s = state.session;
    if (!s) return renderProductSelect();
    const p = PRODUCTS[s.product];
    const isLiquid = s.product === 'liquid';
    const isCushion = s.product === 'cushion';
        const stageStatus = s.stage === 'spreading' ? '스파출러가 손등의 파운데이션을 얼굴에 옮기고 있어요…' : s.stage === 'spread' ? '이제 퍼프로 톡톡 두드려 마무리해요.' : s.stage === 'applying' ? '얼굴에 골고루 펴 바르는 중이에요…' : s.stage === 'blending' ? '브러시로 자연스럽게 블렌딩 중이에요…' : '원하는 만큼 조절한 뒤 얼굴에 발라보세요.';
    let controls = '';
    if (isLiquid) {
      controls = `<div class="tool-card"><span class="tool-emoji">🧴</span><h3>손등에 파운데이션 준비하기</h3><p>펌프로 덜고, 필요하면 양을 조금씩 줄여보세요.</p><div class="amount-display"><span class="amount-label">손등 위 파운데이션 · ${s.quantity}단위</span><span class="amount-object">${isLiquid ? '🤚' : '🫧'}</span>${amountDots(s.quantity)}</div><div class="action-buttons">
        <button class="btn btn-primary" data-action="liquid-pump" ${s.stage !== 'collect' ? 'disabled' : ''}>펌프 누르기 +</button>
        <button class="btn btn-secondary" data-action="liquid-remove" ${s.stage !== 'collect' || s.quantity <= 0 ? 'disabled' : ''}>덜어내기 −</button>
        <button class="btn btn-soft" data-action="liquid-spatula" ${s.stage !== 'collect' || s.quantity <= 0 ? 'disabled' : ''}>스파출러로 얼굴에 펴 바르기</button>
        <button class="btn btn-lavender" data-action="liquid-puff" ${s.stage !== 'spread' ? 'disabled' : ''}>퍼프로 펴 바르기 ♡</button>
      </div></div>`;
    } else if (isCushion) {
      controls = `<div class="tool-card"><span class="tool-emoji">🩷</span><h3>퍼프에 쿠션 묻히기</h3><p>퍼프에 묻는 양을 살펴보고 덜어내며 조절해요.</p><div class="amount-display"><span class="amount-label">퍼프 위 파운데이션 · ${s.quantity}단위</span><span class="amount-object">${isLiquid ? '🤚' : '🫧'}</span>${amountDots(s.quantity)}</div><div class="action-buttons">
        <button class="btn btn-primary" data-action="cushion-load" ${s.stage !== 'collect' ? 'disabled' : ''}>퍼프로 쿠션 찍기 +</button>
        <button class="btn btn-secondary" data-action="cushion-remove" ${s.stage !== 'collect' || s.quantity <= 0 ? 'disabled' : ''}>덜어내기 −</button>
        <button class="btn btn-soft" data-action="cushion-apply" ${s.stage !== 'collect' || s.quantity <= 0 ? 'disabled' : ''}>얼굴에 펴 바르기</button>
      </div></div>`;
    } else {
      controls = `<div class="tool-card"><span class="tool-emoji">💄</span><h3>스틱으로 양 볼에 바르기</h3><p>한 번 누를 때마다 왼쪽 볼과 오른쪽 볼에 한 줄씩 발려요.</p><div class="amount-display"><span class="amount-label">양쪽 볼에 바른 횟수 · ${s.strokes}회</span>${amountDots(s.strokes)}</div><div class="action-buttons">
        <button class="btn btn-primary" data-action="stick-apply" ${s.stage !== 'collect' || s.strokes >= 12 ? 'disabled' : ''}>얼굴에 슥 바르기 +1회</button>
        <button class="btn btn-lavender" data-action="stick-blend" ${s.stage !== 'collect' || s.strokes < 1 ? 'disabled' : ''}>브러시로 펴 바르기 ♡</button>
      </div></div>`;
    }
    const isApplying = ['spreading','applying','blending'].includes(s.stage);
    const stageImage = characterHTML({ mode: isApplying ? 'applying' : 'normal', product: s.product, quantity: s.quantity, strokes: s.strokes, animate: isApplying, showMarks: (isLiquid && s.stage === 'spreading') || (s.product === 'stick' && s.strokes > 0) });
    app.innerHTML = `<section class="screen">
      <div class="training-top"><span class="product-tag">${p.emoji} ${p.name}</span><span class="timer" data-timer>${formatTime(s.elapsed)}</span></div>
      <h1 class="training-title">나에게 맞는 양 찾기</h1><p class="training-hint">양을 직접 조절해 보고, 마지막에 결과를 확인해요.</p>
      <div class="training-board"><div class="character-stage"><span class="stage-sticker">내 피부 설정 반영 중</span>${stageImage}</div><div class="action-panel">${controls}<div class="stage-status" data-stage-status>${stageStatus}</div><button class="btn btn-secondary btn-small" data-action="quit-practice">연습 그만하기</button></div></div>
    </section>`;
  }

  function animateAction(message, duration, next) {
    const status = $('[data-stage-status]');
    if (status) status.textContent = message;
    setTimeout(() => { if (typeof next === 'function') next(); }, duration);
  }

  function calculateScores(session) {
    let makeupScore = 0;
    if (session.product === 'stick') {
      makeupScore = session.strokes >= 1 && session.strokes <= 4 ? 70 : Math.max(0, 70 - Math.max(0, session.strokes - 4) * 10);
    } else {
      const target = session.product === 'liquid' ? SCORE_CONFIG.targetLiquid : SCORE_CONFIG.targetCushion;
      makeupScore = Math.round(70 * Math.max(0, 1 - Math.abs(session.quantity - target) / SCORE_CONFIG.quantityTolerance));
    }
    makeupScore = Math.max(0, Math.min(70, Math.round(makeupScore)));
    const timeScore = Math.max(0, Math.min(30, Math.round(30 * Math.max(0, 1 - session.elapsed / SCORE_CONFIG.timeReferenceSeconds))));
    const rawScore = makeupScore + timeScore;
    const multiplier = session.product === 'liquid' ? SCORE_CONFIG.liquidMultiplier : session.product === 'cushion' ? SCORE_CONFIG.cushionMultiplier : SCORE_CONFIG.stickMultiplier;
    const finalScore = Math.max(0, Math.min(100, Math.round(rawScore * multiplier)));
    return { makeupScore, timeScore, rawScore, finalScore, multiplier };
  }

  function snapshotCharacter(session) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 600; canvas.height = 600;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff8fb'; ctx.fillRect(0,0,600,600);
          ctx.drawImage(img,0,0,600,600);
          const skin = state.skin;
          const product = session.product;
          const imperf = product === 'stick' ? 0 : product === 'liquid' ? .52 : .62;
          if (skin.darkCircles && imperf > 0) {
            [[250,291],[350,291]].forEach(([x,y]) => {
              const g = ctx.createRadialGradient(x,y,2,x,y,43);
              g.addColorStop(0,`rgba(104,68,76,${.27*imperf})`); g.addColorStop(.55,`rgba(136,91,98,${.12*imperf})`); g.addColorStop(1,'rgba(136,91,98,0)');
              ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(x,y,43,14,0,0,Math.PI*2); ctx.fill();
            });
          }
          if (skin.blemishes && imperf > 0) {
            BLEMISH_POINTS.forEach(([px,py],i) => {
              ctx.beginPath(); ctx.fillStyle=`rgba(161,77,77,${(.30+(i%3)*.04)*imperf})`; ctx.arc(600*px/100,600*py/100,2.1+(i%2),0,Math.PI*2); ctx.fill();
            });
          }
          if (skin.texture && imperf > 0) {
            for (let i=0;i<120;i++) {
              const x=190+(i*47%220), y=265+(i*29%170);
              ctx.beginPath(); ctx.fillStyle=`rgba(142,101,94,${.08*imperf})`; ctx.arc(x,y,1.2,0,Math.PI*2); ctx.fill();
            }
          }
          const q = product === 'stick' ? session.strokes : session.quantity;
          const coverage = product === 'stick' ? (.045 + Math.min(1,q/8)*.19) : (.025 + Math.min(1,q/5)*.12);
          ctx.save(); ctx.globalCompositeOperation='screen'; ctx.fillStyle=`rgba(255,226,212,${coverage})`;
          ctx.beginPath(); ctx.ellipse(300,315,155,205,0,0,Math.PI*2); ctx.fill(); ctx.restore();
          // 양을 과하게 사용한 경우에는 제품별로 두꺼운 표현이 조금씩 드러나도록 합니다.
          const excess = Math.max(0, q - (product === 'stick' ? 4 : 5));
          if (excess > 0) {
            const alpha = Math.min(.19, excess * .025);
            [[245,350,34],[355,350,36],[300,390,42]].forEach(([x,y,r]) => {
              const g = ctx.createRadialGradient(x,y,2,x,y,r);
              g.addColorStop(0,`rgba(255,248,239,${alpha})`); g.addColorStop(1,'rgba(255,248,239,0)');
              ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
            });
          }
          const blob = canvas.toDataURL('image/jpeg',.72);
          resolve(blob);
        } catch (_) { resolve(''); }
      };
      img.onerror = () => resolve('');
      img.src = 'assets/character.png';
    });
  }

  async function finishPractice() {
    const s = state.session;
    if (!s || s.finished) return;
    s.finished = true;
    s.elapsed = Math.floor((Date.now() - s.startedAt) / 1000);
    clearInterval(timerHandle); timerHandle = null;
    const scores = calculateScores(s);
    const imageData = await snapshotCharacter(s);
    const record = {
      id: `local-${Date.now()}`,
      product: s.product,
      productName: PRODUCTS[s.product].name,
      quantity: s.quantity,
      strokes: s.strokes,
      elapsed: s.elapsed,
      ...scores,
      imageData,
      createdAt: new Date().toISOString(),
      nickname: state.nickname || '나의 기록',
      remote: false
    };
    state.result = record;
    state.localRecords.unshift(record);
    state.localRecords = state.localRecords.slice(0,30);
    persist();
    state.screen = 'result';
    render();
    // 닉네임이 이미 저장된 사용자는 완료 즉시 공유 랭킹에도 자동 등록합니다.
    if (backendConfigured && state.nickname) setTimeout(() => saveRankingRecord(), 0);
  }

  function renderResult() {
    const r = state.result;
    if (!r) return renderHome();
    const preview = r.imageData ? `<img src="${escapeHtml(r.imageData)}" alt="완성된 메이크업 캐릭터" style="width:100%;display:block;border-radius:18px" />` : characterHTML({mode:'final',product:r.product,quantity:r.quantity,strokes:r.strokes});
    const remoteStatus = r.remote ? '공유 랭킹에 등록되었어요! ♡' : backendConfigured ? '아래에서 닉네임을 입력하고 공유 랭킹에 등록해 보세요.' : '현재 기록은 이 기기에 저장돼요. 공유 랭킹은 Supabase 연결 후 사용할 수 있어요.';
    app.innerHTML = `<section class="screen result-wrap"><div class="section-head"><span class="eyebrow">✦ 연습 완료 ✦</span><h1>오늘의 연습 결과</h1><p>${PRODUCTS[r.product].name} 연습을 완료했어요!</p></div>
      <div class="result-card"><div class="result-character">${preview}</div>
      <h2 class="result-title">화장 완성도</h2>
      <div class="result-stats"><div class="stat"><small>화장 완성도</small><strong>${r.makeupScore} / 70점</strong></div><div class="stat"><small>걸린 시간</small><strong>${formatTime(r.elapsed)}</strong></div><div class="stat"><small>시간 점수</small><strong>${r.timeScore} / 30점</strong></div><div class="stat"><small>적용된 제품 가중치</small><strong>× ${r.multiplier.toFixed(2)}</strong></div></div>
      <div class="final-score"><small>✦ 최종 점수 ✦</small><strong><span data-score-number>0</span><span style="font:18px 'Gowun Dodum'"> 점</span></strong></div>
      <p class="result-note">${remoteStatus}<br>${r.product === 'stick' ? '스틱은 1~4회 도포를 적정량으로 계산했어요.' : '리퀴드와 쿠션은 선택한 피부 고민이 일부 남도록 표현했어요.'}</p>
      ${backendConfigured && !r.remote ? `<div class="nickname-box"><label for="nickname">랭킹에 표시할 닉네임</label><input id="nickname" maxlength="12" value="${escapeHtml(state.nickname)}" placeholder="개인정보가 아닌 별명을 입력해 주세요" /><p class="disclaimer">실명, 전화번호 등 개인정보는 입력하지 마세요. 닉네임은 랭킹에 공개됩니다.</p></div><button class="btn btn-primary btn-small" style="width:100%;margin-top:10px" data-action="save-rank" ${state.saving?'disabled':''}>${state.saving?'랭킹 등록 중…':'랭킹에 등록하기 🏆'}</button>` : ''}
      <div class="result-actions"><button class="btn btn-primary" data-action="again">다시 연습하기</button><button class="btn btn-secondary" data-action="other">다른 제품 연습하기</button><button class="btn btn-soft" data-action="home">메인으로 돌아가기</button><button class="btn btn-lavender" data-action="ranking">랭킹 확인하기</button></div></div></section>`;
    animateScore(r.finalScore);
  }

  function animateScore(target) {
    const node = $('[data-score-number]');
    if (!node) return;
    if (scoreAnimationHandle) clearInterval(scoreAnimationHandle);
    let current = 0;
    const step = Math.max(1, Math.ceil(Number(target || 0) / 36));
    node.textContent = '0';
    scoreAnimationHandle = setInterval(() => {
      current = Math.min(Number(target || 0), current + step);
      node.textContent = String(current);
      if (current >= Number(target || 0)) {
        clearInterval(scoreAnimationHandle);
        scoreAnimationHandle = null;
      }
    }, 24);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderRanking() {
    const localRows = state.localRecords;
    const rows = state.rankingRows;
    const content = backendConfigured
      ? (rows.length ? rows.map((r,i) => rankRowHTML(r,i+1)).join('') : '<div class="rank-empty">아직 공유 랭킹 기록이 없어요.<br>첫 번째 주인공이 되어보세요! ♡</div>')
      : (localRows.length ? localRows.map((r,i) => rankRowHTML({ ...r, nickname: r.nickname || state.nickname || '나의 기록', elapsed_seconds:r.elapsed, product_type:r.product, final_score:r.finalScore, image_url:r.imageData },i+1)).join('') : '<div class="rank-empty">아직 이 기기에 저장된 연습 기록이 없어요.<br>첫 연습을 완료하고 기록을 만들어보세요! ♡</div>');
    app.innerHTML = `<section class="screen rank-wrap"><div class="section-head"><span class="eyebrow">✦ TOP 30 ✦</span><h1>양조절 랭킹</h1><p>${backendConfigured ? '모든 사용자의 최고 점수를 함께 확인해요.' : '이 기기에서 완료한 연습 기록이에요.'}</p></div>
      ${!backendConfigured ? '<div class="backend-notice"><strong>기기 내 기록 모드</strong><br>아직 공유 데이터베이스가 연결되지 않았어요. 아래 기록은 이 브라우저에만 저장되며 다른 사용자에게 보이지 않습니다. 공유 TOP 30을 활성화하려면 프로젝트의 config.js와 Supabase SQL을 설정해 주세요.</div>' : '<div class="backend-notice">공유 랭킹은 최종 점수 순으로 최대 30개 기록을 보여줘요.</div>'}
      <div class="panel"><div class="rank-header"><strong style="font-family:Jua;font-size:17px">🏆 ${backendConfigured ? '전체 사용자 TOP 30' : '내 연습 기록'}</strong><button class="btn btn-secondary btn-small" data-action="refresh-ranking">새로고침</button></div><div class="rank-list" id="rank-list">${content}</div></div>
      <div style="text-align:center;margin-top:16px"><button class="btn btn-primary" data-action="practice">연습하러 가기</button><button class="btn btn-secondary btn-small" style="margin-left:7px" data-action="home">메인으로</button></div>
    </section>`;
    if (backendConfigured) fetchLeaderboard();
  }

  function rankRowHTML(row, rank) {
    const prod = PRODUCTS[row.product_type || row.product] || PRODUCTS.liquid;
    const name = escapeHtml(row.nickname || row.profiles?.nickname || '익명의 연습생');
    const score = Number(row.final_score ?? row.finalScore ?? 0);
    const elapsed = Number(row.elapsed_seconds ?? row.elapsed ?? 0);
    const imageUrl = row.image_url || row.imageData || '';
    const safeImageUrl = escapeHtml(imageUrl);
    const thumb = safeImageUrl ? `<img src="${safeImageUrl}" alt="캐릭터" />` : `<div style="height:100%;display:grid;place-items:center">${prod.emoji}</div>`;
    const medal = rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank);
    return `<article class="rank-row ${rank<=3?'rank-'+rank:''}"><div class="rank-no">${medal}</div><div class="rank-thumb">${thumb}</div><div><div class="rank-name">${name}</div><div class="rank-meta">${prod.name} · ${formatTime(elapsed)}</div></div><div class="rank-score">${score}<small>점</small></div></article>`;
  }

  function render() {
    if (state.screen === 'home') renderHome();
    else if (state.screen === 'skin') renderSkinSettings();
    else if (state.screen === 'reveal') renderReveal();
    else if (state.screen === 'select') renderProductSelect();
    else if (state.screen === 'training') renderTraining();
    else if (state.screen === 'result') renderResult();
    else if (state.screen === 'ranking') renderRanking();
  }

  function startPractice(product) {
    clearInterval(timerHandle);
    state.session = { product, quantity: 0, strokes: 0, stage: 'collect', startedAt: Date.now(), elapsed: 0, finished: false };
    state.result = null;
    state.screen = 'training';
    render();
    timerHandle = setInterval(() => {
      if (!state.session || state.screen !== 'training') return;
      state.session.elapsed = Math.floor((Date.now() - state.session.startedAt) / 1000);
      const timer = $('[data-timer]'); if (timer) timer.textContent = formatTime(state.session.elapsed);
    }, 250);
  }

  function goHome() {
    clearInterval(timerHandle); timerHandle = null;
    state.session = null;
    state.screen = 'home';
    render();
  }

  function startSkinReveal() {
    state.hasConfiguredSkin = true;
    persist();
    state.screen = 'reveal';
    render();
  }

  async function ensureSupabaseUser() {
    if (!backendConfigured || !window.supabase?.createClient) throw new Error('공유 랭킹 연결 설정을 확인해 주세요.');
    if (!supabaseClient) supabaseClient = window.supabase.createClient(window.APP_CONFIG.supabaseUrl, window.APP_CONFIG.supabaseAnonKey);
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    let user = sessionData.session?.user;
    if (!user) {
      const { data, error } = await supabaseClient.auth.signInAnonymously();
      if (error) throw error;
      user = data.user;
    }
    if (!user) throw new Error('사용자 연결을 완료하지 못했어요.');
    supabaseUser = user;
    return user;
  }

  async function saveRankingRecord() {
    const r = state.result;
    if (!r || state.saving || r.remote) return;
    const input = $('#nickname');
    const nickname = (input?.value || state.nickname || '').trim();
    if (!nickname) { showToast('랭킹에 표시할 닉네임을 입력해 주세요.'); input?.focus(); return; }
    if (nickname.length > 12) { showToast('닉네임은 12자 이내로 입력해 주세요.'); return; }
    state.nickname = nickname; persist(); state.saving = true; renderResult();
    try {
      const user = await ensureSupabaseUser();
      const { error: profileError } = await supabaseClient.from('profiles').upsert({
        user_id: user.id,
        nickname,
        skin_dark_circles: state.skin.darkCircles,
        skin_blemishes: state.skin.blemishes,
        skin_uneven_texture: state.skin.texture
      }, { onConflict: 'user_id' });
      if (profileError) throw profileError;
      let imagePath = null;
      if (r.imageData) {
        const blob = await (await fetch(r.imageData)).blob();
        imagePath = `${user.id}/${Date.now()}.jpg`;
        const { error: uploadError } = await supabaseClient.storage.from('final-faces').upload(imagePath, blob, { contentType: 'image/jpeg', upsert: true });
        if (uploadError) throw uploadError;
      }
      const { data, error } = await supabaseClient.rpc('submit_practice_record', {
        p_product_type: r.product,
        p_quantity: r.quantity,
        p_strokes: r.strokes,
        p_elapsed_seconds: r.elapsed,
        p_image_path: imagePath
      });
      if (error) throw error;
      r.remote = true;
      r.remoteRecord = data;
      r.nickname = nickname;
      state.saving = false;
      persist(); renderResult();
      setSaveState('공유 랭킹 등록 완료');
      showToast('공유 랭킹에 등록했어요! ♡');
    } catch (error) {
      console.error(error);
      state.saving = false;
      renderResult();
      showToast(`랭킹 등록 실패: ${error.message || '연결 설정을 확인해 주세요.'}`);
    }
  }

  async function fetchLeaderboard() {
    const list = $('#rank-list');
    if (list) list.innerHTML = '<div class="rank-empty loading-dots">랭킹을 불러오고 있어요</div>';
    try {
      await ensureSupabaseUser();
      const { data, error } = await supabaseClient.from('practice_records')
        .select('record_id, product_type, final_score, elapsed_seconds, image_path, created_at, profiles(nickname)')
        .order('final_score', { ascending: false }).order('created_at', { ascending: true }).limit(30);
      if (error) throw error;
      state.rankingRows = (data || []).map(row => {
        const imageUrl = row.image_path ? supabaseClient.storage.from('final-faces').getPublicUrl(row.image_path).data.publicUrl : '';
        return { ...row, nickname: row.profiles?.nickname, image_url: imageUrl };
      });
      const node = $('#rank-list');
      if (node) node.innerHTML = state.rankingRows.length ? state.rankingRows.map((r,i) => rankRowHTML(r,i+1)).join('') : '<div class="rank-empty">아직 공유 랭킹 기록이 없어요.<br>첫 번째 주인공이 되어보세요! ♡</div>';
    } catch (error) {
      console.error(error);
      const node = $('#rank-list');
      if (node) node.innerHTML = `<div class="rank-empty">공유 랭킹을 불러오지 못했어요.<br>${escapeHtml(error.message || 'Supabase 설정을 확인해 주세요.')}</div>`;
    }
  }

  app.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'home') return goHome();
    if (action === 'open-skin') { state.screen = 'skin'; return render(); }
    if (action === 'skin-toggle') {
      const key = button.dataset.key;
      state.skin[key] = !state.skin[key]; persist(); return renderSkinSettings();
    }
    if (action === 'skin-save') { startSkinReveal(); return; }
    if (action === 'reveal-continue') { state.screen = revealNextScreen; return render(); }
    if (action === 'practice') {
      if (!state.hasConfiguredSkin) { state.screen = 'skin'; showToast('먼저 나와 비슷한 피부를 설정해 주세요!'); return render(); }
      state.screen = 'select'; return render();
    }
    if (action === 'select-product') return startPractice(button.dataset.product);
    if (action === 'ranking') { state.screen = 'ranking'; return render(); }
    if (action === 'refresh-ranking') return backendConfigured ? fetchLeaderboard() : renderRanking();
    if (action === 'quit-practice') { clearInterval(timerHandle); timerHandle=null; state.session=null; state.screen='select'; return render(); }
    if (action === 'again') return startPractice(state.result.product);
    if (action === 'other') { state.result=null; state.session=null; state.screen='select'; return render(); }
    if (action === 'save-rank') return saveRankingRecord();

    const s = state.session;
    if (!s || s.finished) return;
    if (action === 'liquid-pump' && s.product === 'liquid' && s.stage === 'collect') {
      const add = randomInt(1,5); s.quantity += add; renderTraining(); showToast(`파운데이션 ${add}단위를 덜었어요.`);
    } else if (action === 'liquid-remove' && s.product === 'liquid' && s.stage === 'collect' && s.quantity > 0) {
      const remove = Math.min(s.quantity,randomInt(2,3)); s.quantity -= remove; renderTraining(); showToast(`${remove}단위를 덜어냈어요.`);
    } else if (action === 'liquid-spatula' && s.product === 'liquid' && s.stage === 'collect' && s.quantity > 0) {
      s.stage = 'spreading'; renderTraining();
      animateAction('스파출러가 양 볼에 얇게 펴 바르고 있어요…', 1200, () => { if (state.session === s) { s.stage = 'spread'; renderTraining(); } });
    } else if (action === 'liquid-puff' && s.product === 'liquid' && s.stage === 'spread') {
      s.stage = 'blending'; renderTraining();
      animateAction('퍼프로 톡톡 두드려 밀착시키고 있어요…', 1300, () => { if (state.session === s) finishPractice(); });
    } else if (action === 'cushion-load' && s.product === 'cushion' && s.stage === 'collect') {
      const add = randomInt(1,5); s.quantity += add; renderTraining(); showToast(`퍼프에 ${add}단위가 묻었어요.`);
    } else if (action === 'cushion-remove' && s.product === 'cushion' && s.stage === 'collect' && s.quantity > 0) {
      const remove = Math.min(s.quantity,randomInt(1,5)); s.quantity -= remove; renderTraining(); showToast(`${remove}단위를 덜어냈어요.`);
    } else if (action === 'cushion-apply' && s.product === 'cushion' && s.stage === 'collect' && s.quantity > 0) {
      s.stage = 'applying'; renderTraining();
      animateAction('퍼프로 얼굴 전체를 톡톡 두드리고 있어요…', 1500, () => { if (state.session === s) finishPractice(); });
    } else if (action === 'stick-apply' && s.product === 'stick' && s.stage === 'collect' && s.strokes < 12) {
      s.strokes += 1; renderTraining(); showToast('양쪽 볼에 한 번씩 발랐어요.');
    } else if (action === 'stick-blend' && s.product === 'stick' && s.stage === 'collect' && s.strokes > 0) {
      s.stage = 'blending'; renderTraining();
      animateAction('브러시로 얼굴 전체를 부드럽게 블렌딩 중이에요…', 1500, () => { if (state.session === s) finishPractice(); });
    }
  });

  app.addEventListener('input', event => {
    if (event.target.id === 'nickname') {
      const next = event.target.value.slice(0,12);
      state.nickname = next;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ skin:state.skin, hasConfiguredSkin:state.hasConfiguredSkin, nickname:state.nickname, localRecords:state.localRecords.slice(0,30) })); } catch (_) {}
    }
  });

  // Optional Supabase client availability check. Credentials are intentionally not bundled.
  if (backendConfigured) {
    setSaveState('Supabase 설정됨');
  } else {
    setSaveState('이 기기에 저장');
  }
  render();
})();
