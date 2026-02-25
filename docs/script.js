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

  window.copyToClipboard = function(text) {
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
      if (href === '#') return;
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

  const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateStats();
        statsObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  const heroStats = document.querySelector('.hero-stats');
  if (heroStats) statsObserver.observe(heroStats);

  // Fade animations
  const fadeElements = document.querySelectorAll('.feature-card, .section-header, .code-container');
  const fadeObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  fadeElements.forEach((el) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    fadeObserver.observe(el);
  });

  // Mobile Menu
  const mobileToggle = document.querySelector('.mobile-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      navLinks.classList.toggle('active');
    });
  }

  // Orchestration Cortex Animation
  const cortex = document.querySelector('.orchestration-cortex');
  const fleetContainer = document.getElementById('agent-fleet');
  const linksContainer = document.getElementById('cortex-links');
  const hologramData = document.querySelector('.hologram-data');

  if (cortex && fleetContainer && linksContainer) {
    const agents = [];
    const numAgents = 15;
    const missions = [
      'MISSION: CLAUDE_REFACTOR', 'MISSION: GEMINI_STRAT', 'MISSION: QWEN_OPTIMIZE',
      'MISSION: KILO_DEPLOY', 'MISSION: CLINE_ARCHITECT', 'MISSION: OPENCLAW_SUBMIT',
      'MISSION: DEEPSEEK_ANALYZE', 'MISSION: OLLAMA_LOCAL_SYNC'
    ];

    for (let i = 0; i < numAgents; i++) {
      const node = document.createElement('div');
      node.className = 'agent-node';
      fleetContainer.appendChild(node);
      agents.push({
        el: node,
        angle: Math.random() * Math.PI * 2,
        baseRadius: 100 + Math.random() * 120,
        radius: 0,
        speed: 0.005 + Math.random() * 0.01,
        active: false
      });
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;';
    linksContainer.appendChild(svg);

    const lines = agents.map(() => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'link-line');
      svg.appendChild(line);
      return line;
    });

    function animateFleet() {
      const width = cortex.offsetWidth;
      const height = cortex.offsetHeight;
      const centerX = width / 2;
      const centerY = height / 2;
      const scale = Math.max(0.5, width / 500);

      const core = document.querySelector('.cortex-core');
      if (core) core.style.transform = `translate(-50%, -50%) scale(${scale})`;

      agents.forEach((agent, i) => {
        agent.angle += agent.speed;
        agent.radius = agent.baseRadius * scale;
        const x = centerX + Math.cos(agent.angle) * agent.radius;
        const y = centerY + Math.sin(agent.angle) * agent.radius;

        agent.el.style.left = `${x}px`;
        agent.el.style.top = `${y}px`;
        agent.el.style.transform = `translate(-50%, -50%) scale(${scale})`;

        const line = lines[i];
        if (agent.active) {
          line.setAttribute('x1', centerX);
          line.setAttribute('y1', centerY);
          line.setAttribute('x2', x);
          line.setAttribute('y2', y);
          line.setAttribute('class', 'link-line active');
          line.setAttribute('style', `stroke-width: ${2 * scale}; stroke: #3b82f6;`);
        } else {
          line.setAttribute('class', 'link-line');
          line.setAttribute('style', 'opacity: 0;');
        }
      });
      requestAnimationFrame(animateFleet);
    }
    animateFleet();

    setInterval(() => {
      const agent = agents[Math.floor(Math.random() * agents.length)];
      agent.active = true;
      agent.el.classList.add('active');

      if (Math.random() > 0.7 && hologramData) {
        const missionLines = hologramData.querySelectorAll('.data-line');
        if (missionLines[2]) {
          missionLines[2].textContent = missions[Math.floor(Math.random() * missions.length)];
          missionLines[2].style.color = '#00fff5';
          setTimeout(() => missionLines[2].style.color = '', 500);
        }
      }

      setTimeout(() => {
        agent.active = false;
        agent.el.classList.remove('active');
      }, 1500 + Math.random() * 2000);
    }, 800);

    const cortexCore = document.querySelector('.cortex-core');
    if (cortexCore) {
      cortexCore.addEventListener('click', () => {
        agents.forEach(a => {
          a.active = true;
          a.el.classList.add('active');
          setTimeout(() => { a.active = false; a.el.classList.remove('active'); }, 1000);
        });
        if (hologramData) {
          const status = hologramData.querySelector('.data-line:first-child');
          const original = status.textContent;
          status.textContent = 'STATUS: OVERDRIVE';
          status.style.color = '#3b82f6';
          setTimeout(() => { status.textContent = original; status.style.color = ''; }, 1000);
        }
      });
    }
  }

  // Easter Egg
  console.log('%c🧠 OverMind-MCP', 'font-size: 20px; font-weight: bold; color: #00fff5;');
  console.log('%cInfrastructure Orchestration Active', 'color: #3b82f6;');
});
