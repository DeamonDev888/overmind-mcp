// Matrix Rain Effect
const canvas = document.getElementById('matrix');
const ctx = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()_+-=[]{}|;:,.<>?';
const charArray = chars.split('');

const fontSize = 14;
const columns = canvas.width / fontSize;

const drops = [];
for (let i = 0; i < columns; i++) {
  drops[i] = 1;
}

function drawMatrix() {
  ctx.fillStyle = 'rgba(6, 6, 9, 0.08)'; // Matches new dark-bg
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#00fff5';
  ctx.font = fontSize + 'px monospace';

  for (let i = 0; i < drops.length; i++) {
    const text = charArray[Math.floor(Math.random() * charArray.length)];
    ctx.fillText(text, i * fontSize, drops[i] * fontSize);

    if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
      drops[i] = 0;
    }
    drops[i]++;
  }
}

setInterval(drawMatrix, 50);

// Resize handler
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const newColumns = Math.floor(canvas.width / fontSize);
  if (newColumns > drops.length) {
    for (let i = drops.length; i < newColumns; i++) drops[i] = 1;
  }
});

// SVG Filter Animation Logic
const glitchFilter = document.querySelector('#cyber-glitch feTurbulence');
if (glitchFilter) {
  let glitchBaseFreq = 0.00001;
  setInterval(() => {
    // Jitter the displacement map slightly for the 'glitch' effect
    const noise = Math.random() * 0.05;
    glitchFilter.setAttribute('baseFrequency', `${glitchBaseFreq} ${noise}`);
  }, 100);
}

// Main initialization
document.addEventListener('DOMContentLoaded', () => {
  // Tab functionality
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      tabBtns.forEach((b) => b.classList.remove('active'));
      tabContents.forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(tabId);
      if (target) target.classList.add('active');
    });
  });

  // Copy functionality
  const copyBtns = document.querySelectorAll('.copy-btn, .terminal-copy');

  window.copyToClipboard = function (text) {
    navigator.clipboard.writeText(text).then(() => {
      console.log('Copied to clipboard:', text);
    });
  };

  copyBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      let code;
      if (btn.classList.contains('terminal-copy')) {
        code = btn.previousElementSibling.textContent;
      } else {
        const codeContainer = btn.closest('.code-container');
        code = codeContainer.querySelector('code').textContent;
      }

      navigator.clipboard.writeText(code).then(() => {
        const originalIcon = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i>';
        btn.style.color = '#00ff00';
        setTimeout(() => {
          btn.innerHTML = originalIcon;
          btn.style.color = '';
        }, 2000);
      });
    });
  });

  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#' || !href.startsWith('#')) return;
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Stats counter
  const stats = document.querySelectorAll('.stat-value');
  const animateStats = () => {
    stats.forEach((stat) => {
      const target = parseInt(stat.getAttribute('data-target'));
      const duration = 2000;
      const increment = target / (duration / 16);
      let current = 0;
      const updateStat = () => {
        current += increment;
        if (current < target) {
          stat.textContent = Math.floor(current);
          requestAnimationFrame(updateStat);
        } else {
          stat.textContent = target;
        }
      };
      updateStat();
    });
  };

  const statsObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateStats();
          statsObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 },
  );

  const heroStats = document.querySelector('.hero-stats');
  if (heroStats) statsObserver.observe(heroStats);

  // Feature cards 3D effect
  const featureCards = document.querySelectorAll('.feature-card');
  featureCards.forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = (y - centerY) / 20;
      const rotateY = (centerX - x) / 20;
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-10px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateY(0)';
    });
  });

  // Mobile Menu
  const mobileToggle = document.querySelector('.mobile-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      navLinks.classList.toggle('active');
    });
  }

  // PROFESSIONAL CORTEX ENGINE
  const cortex = document.querySelector('.orchestration-cortex');
  const fleetContainer = document.getElementById('agent-fleet');
  const linksContainer = document.getElementById('cortex-links');
  const hologramData = document.querySelector('.hologram-data');

  if (cortex && fleetContainer && linksContainer) {
    const agents = [];
    const numAgents = 24;
    const missions = [
      'STATUS: OPTIMIZING_NEURAL_FLOW',
      'STATUS: VECTOR_SYMMETRY_ACTIVE',
      'STATUS: MCP_HANDSHAKE_VALID',
      'STATUS: DISTRIBUTED_COGNITION',
      'STATUS: PROTOCOL_ALIGNMENT',
      'STATUS: SYSTEM_INTEGRITY_MAX',
    ];

    for (let i = 0; i < numAgents; i++) {
      const node = document.createElement('div');
      node.className = 'agent-node';
      fleetContainer.appendChild(node);

      const angle = (i / numAgents) * Math.PI * 2;
      const layer = i % 3; // 3 distinct orbital layers
      const baseRadius = 120 + layer * 50;

      agents.push({
        el: node,
        angle: angle,
        baseRadius: baseRadius,
        radius: 0,
        speed: (0.002 + Math.random() * 0.004) * (layer === 1 ? -1 : 1),
        active: false,
        lastActivation: 0,
      });
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText =
      'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;';
    linksContainer.appendChild(svg);

    const lines = agents.map(() => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'link-line');
      svg.appendChild(line);
      return line;
    });

    function sendDataBurst(startX, startY, endX, endY) {
      const p = document.createElement('div');
      p.className = 'data-particle';
      cortex.appendChild(p);

      let progress = 0;
      const speed = 0.015 + Math.random() * 0.02;

      function step() {
        progress += speed;
        p.style.left = `${startX + (endX - startX) * progress}px`;
        p.style.top = `${startY + (endY - startY) * progress}px`;

        if (progress < 1) requestAnimationFrame(step);
        else p.remove();
      }
      step();
    }

    function animateCortex() {
      const cw = cortex.offsetWidth;
      const ch = cortex.offsetHeight;
      const cx = cw / 2;
      const cy = ch / 2;
      const scale = Math.max(0.5, cw / 600);

      const core = document.querySelector('.cortex-core');
      if (core) {
        const pulse = 1 + Math.sin(Date.now() / 1500) * 0.03;
        core.style.transform = `translate(-50%, -50%) scale(${scale * pulse})`;
      }

      agents.forEach((agent, i) => {
        agent.angle += agent.speed;
        agent.radius = agent.baseRadius * scale;
        const ax = cx + Math.cos(agent.angle) * agent.radius;
        const ay = cy + Math.sin(agent.angle) * agent.radius;

        agent.el.style.left = `${ax}px`;
        agent.el.style.top = `${ay}px`;

        const agentScale = agent.active ? scale * 1.4 : scale;
        agent.el.style.transform = `translate(-50%, -50%) scale(${agentScale})`;
        agent.el.style.opacity = agent.active ? '1' : '0.4';

        const line = lines[i];
        line.setAttribute('x1', cx);
        line.setAttribute('y1', cy);
        line.setAttribute('x2', ax);
        line.setAttribute('y2', ay);

        if (agent.active) {
          line.setAttribute('class', 'link-line active');
        } else {
          line.setAttribute('class', 'link-line');
        }
      });
      requestAnimationFrame(animateCortex);
    }
    animateCortex();

    // Autonomous systemic logic
    setInterval(() => {
      const available = agents.filter((a) => !a.active);
      if (available.length > 0 && Math.random() > 0.4) {
        const a = available[Math.floor(Math.random() * available.length)];
        a.active = true;
        a.el.classList.add('active');

        // Logical data transmission
        setTimeout(
          () =>
            sendDataBurst(
              cw / 2,
              ch / 2,
              cw / 2 + Math.cos(a.angle) * a.radius,
              ch / 2 + Math.sin(a.angle) * a.radius,
            ),
          100,
        );

        setTimeout(
          () => {
            a.active = false;
            a.el.classList.remove('active');
          },
          1500 + Math.random() * 2000,
        );
      }

      // Update terminal status log logic
      if (Math.random() > 0.8 && hologramData) {
        const lines = hologramData.querySelectorAll('.data-line');
        lines[1].textContent = `ACTIVE_NODES: ${agents.filter((a) => a.active).length}/${numAgents}`;
        if (Math.random() > 0.5) {
          lines[0].textContent = missions[Math.floor(Math.random() * missions.length)];
        }
      }
    }, 1000);

    // Interactive Core (Professional Interaction)
    const coreTrigger = document.querySelector('.cortex-core');
    if (coreTrigger) {
      coreTrigger.addEventListener('click', () => {
        // High-level systemic synchronization
        agents.forEach((a, idx) => {
          setTimeout(() => {
            a.active = true;
            a.el.classList.add('active');
            sendDataBurst(
              cortex.offsetWidth / 2,
              cortex.offsetHeight / 2,
              cortex.offsetWidth / 2 + Math.cos(a.angle) * a.radius,
              cortex.offsetHeight / 2 + Math.sin(a.angle) * a.radius,
            );
            setTimeout(() => {
              a.active = false;
              a.el.classList.remove('active');
            }, 2000);
          }, idx * 30);
        });
      });
    }
  }
});
