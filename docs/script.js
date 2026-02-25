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

  // Orchestration Cortex Animation - SUPER UPGRADED
  const cortex = document.querySelector('.orchestration-cortex');
  const fleetContainer = document.getElementById('agent-fleet');
  const linksContainer = document.getElementById('cortex-links');
  const hologramData = document.querySelector('.hologram-data');

  if (cortex && fleetContainer && linksContainer) {
    const agents = [];
    const numAgents = 20; // Increased
    const missions = [
      'MISSION: CLAUDE_REFACTOR', 'MISSION: GEMINI_STRAT', 'MISSION: QWEN_OPTIMIZE',
      'MISSION: KILO_DEPLOY', 'MISSION: CLINE_ARCHITECT', 'MISSION: OPENCLAW_SUBMIT',
      'MISSION: DEEPSEEK_ANALYZE', 'MISSION: OLLAMA_LOCAL_SYNC', 'MISSION: NEURAL_OVERVIEW',
      'MISSION: VECTOR_INGEST', 'MISSION: MCP_BRIDGE_ACTIVE'
    ];

    for (let i = 0; i < numAgents; i++) {
      const node = document.createElement('div');
      node.className = 'agent-node';
      fleetContainer.appendChild(node);
      
      const angle = (i / numAgents) * Math.PI * 2;
      const baseRadius = 110 + (i % 3) * 40; // Rings effect

      agents.push({
        el: node,
        angle: angle,
        baseRadius: baseRadius,
        radius: 0,
        speed: (0.003 + Math.random() * 0.005) * (i % 2 === 0 ? 1 : -1), // Reverse orbits
        active: false,
        pulseValue: 0
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

    // Particle system for "packets"
    function sendPacket(startX, startY, endX, endY) {
      const p = document.createElement('div');
      p.className = 'data-particle';
      cortex.appendChild(p);
      
      let progress = 0;
      const speed = 0.02 + Math.random() * 0.03;
      
      function animatePacket() {
        progress += speed;
        const curX = startX + (endX - startX) * progress;
        const curY = startY + (endY - startY) * progress;
        
        p.style.left = `${curX}px`;
        p.style.top = `${curY}px`;
        
        if (progress < 1) {
          requestAnimationFrame(animatePacket);
        } else {
          p.remove();
        }
      }
      animatePacket();
    }

    function animateFleet() {
      const width = cortex.offsetWidth;
      const height = cortex.offsetHeight;
      const centerX = width / 2;
      const centerY = height / 2;
      const scale = Math.max(0.6, width / 550);

      const core = document.querySelector('.cortex-core');
      if (core) {
        const coreScale = scale * (1 + Math.sin(Date.now() / 1000) * 0.05);
        core.style.transform = `translate(-50%, -50%) scale(${coreScale})`;
      }

      agents.forEach((agent, i) => {
        agent.angle += agent.speed;
        agent.radius = agent.baseRadius * scale;
        const x = centerX + Math.cos(agent.angle) * agent.radius;
        const y = centerY + Math.sin(agent.angle) * agent.radius;

        agent.el.style.left = `${x}px`;
        agent.el.style.top = `${y}px`;
        
        const agentScale = agent.active ? scale * 1.5 : scale;
        agent.el.style.transform = `translate(-50%, -50%) scale(${agentScale})`;

        const line = lines[i];
        if (agent.active) {
          line.setAttribute('x1', centerX);
          line.setAttribute('y1', centerY);
          line.setAttribute('x2', x);
          line.setAttribute('y2', y);
          line.setAttribute('class', 'link-line active');
          line.setAttribute('style', `stroke-width: ${2 * scale}; stroke: #00fff5; opacity: 0.8;`);
          
          if (Math.random() > 0.9) sendPacket(centerX, centerY, x, y);
        } else {
          line.setAttribute('class', 'link-line');
          line.setAttribute('style', 'opacity: 0.1; stroke: rgba(0, 255, 245, 0.1);');
          line.setAttribute('x1', centerX);
          line.setAttribute('y1', centerY);
          line.setAttribute('x2', x);
          line.setAttribute('y2', y);
        }
      });
      requestAnimationFrame(animateFleet);
    }
    animateFleet();

    // Minigame/Interactive cycle
    setInterval(() => {
      const activeCount = agents.filter(a => a.active).length;
      if (activeCount < 5) {
        const agent = agents[Math.floor(Math.random() * agents.length)];
        if (!agent.active) {
          agent.active = true;
          agent.el.classList.add('active');
          
          if (Math.random() > 0.6 && hologramData) {
            const missionLines = hologramData.querySelectorAll('.data-line');
            missionLines[2].textContent = missions[Math.floor(Math.random() * missions.length)];
          }

          setTimeout(() => {
            agent.active = false;
            agent.el.classList.remove('active');
          }, 1000 + Math.random() * 3000);
        }
      }
    }, 600);

    // Interactive Core (Explosion game)
    const cortexCore = document.querySelector('.cortex-core');
    if (cortexCore) {
      cortexCore.addEventListener('mousedown', () => {
        cortexCore.style.transform = 'translate(-50%, -50%) scale(0.9)';
      });
      cortexCore.addEventListener('mouseup', () => {
        cortexCore.style.transform = 'translate(-50%, -50%) scale(1.1)';
        // Trigger massive cascade
        agents.forEach((a, idx) => {
          setTimeout(() => {
            a.active = true;
            a.el.classList.add('active');
            sendPacket(width/2, height/2, width/2 + Math.cos(a.angle)*a.radius, height/2 + Math.sin(a.angle)*a.radius);
            setTimeout(() => { a.active = false; a.el.classList.remove('active'); }, 1500);
          }, idx * 50);
        });
        
        if (hologramData) {
          const status = hologramData.querySelector('.data-line:first-child');
          status.textContent = 'STATUS: OVERDRIVE_SYNC';
          status.style.color = '#ff006e';
          setTimeout(() => { status.textContent = 'STATUS: SUPREME'; status.style.color = ''; }, 2000);
        }
      });
    }
    
    // Mouse hover interaction
    cortex.addEventListener('mousemove', (e) => {
      const rect = cortex.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      agents.forEach(a => {
        const ax = cortex.offsetWidth / 2 + Math.cos(a.angle) * a.radius;
        const ay = cortex.offsetHeight / 2 + Math.sin(a.angle) * a.radius;
        const dist = Math.sqrt((mx - ax)**2 + (my - ay)**2);
        
        if (dist < 40) {
          a.active = true;
          a.el.classList.add('active');
          setTimeout(() => { if (dist >= 40) { a.active = false; a.el.classList.remove('active'); } }, 500);
        }
      });
    });
  }
});
