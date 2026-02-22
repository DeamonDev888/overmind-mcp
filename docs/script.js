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
    ctx.fillStyle = 'rgba(10, 10, 15, 0.05)';
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
});

// Tab functionality
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');

        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(tabId).classList.add('active');
    });
});

// Copy functionality
const copyBtns = document.querySelectorAll('.copy-btn');

copyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const codeContainer = btn.closest('.code-container');
        const code = codeContainer.querySelector('code').textContent;

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
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));

        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Stats counter animation
const stats = document.querySelectorAll('.stat-value');

const animateStats = () => {
    stats.forEach(stat => {
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

// Intersection Observer for stats
const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            animateStats();
            statsObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.5 });

const heroStats = document.querySelector('.hero-stats');
if (heroStats) {
    statsObserver.observe(heroStats);
}

// Intersection Observer for fade-in animations
const fadeElements = document.querySelectorAll('.feature-card, .section-header, .code-container');

const fadeObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, { threshold: 0.1 });

fadeElements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(30px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    fadeObserver.observe(el);
});

// Mobile menu toggle
const mobileToggle = document.querySelector('.mobile-toggle');
const navLinks = document.querySelector('.nav-links');

if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
        navLinks.classList.toggle('active');

        const spans = mobileToggle.querySelectorAll('span');
        spans[0].style.transform = navLinks.classList.contains('active') ? 'rotate(45deg) translateY(8px)' : '';
        spans[1].style.opacity = navLinks.classList.contains('active') ? '0' : '1';
        spans[2].style.transform = navLinks.classList.contains('active') ? 'rotate(-45deg) translateY(-8px)' : '';
    });
}

// Add mobile menu styles
const style = document.createElement('style');
style.textContent = `
    @media (max-width: 768px) {
        .nav-links.active {
            display: flex;
            flex-direction: column;
            position: absolute;
            top: 100%;
            left: 0;
            width: 100%;
            background: rgba(10, 10, 15, 0.98);
            padding: 20px;
            border-top: 1px solid rgba(0, 255, 245, 0.1);
        }

        .nav-links.active .nav-link {
            padding: 15px 0;
            border-bottom: 1px solid rgba(0, 255, 245, 0.1);
        }
    }
`;
document.head.appendChild(style);

// Glitch effect on hover for logo
const logo = document.querySelector('.logo');
if (logo) {
    logo.addEventListener('mouseenter', () => {
        logo.style.animation = 'none';
        setTimeout(() => {
            logo.style.animation = '';
        }, 10);
    });
}

// Parallax effect for orbs
document.addEventListener('mousemove', (e) => {
    const mouseX = e.clientX / window.innerWidth;
    const mouseY = e.clientY / window.innerHeight;

    const orbs = document.querySelectorAll('.orb');
    orbs.forEach((orb, index) => {
        const speed = (index + 1) * 20;
        const x = (mouseX - 0.5) * speed;
        const y = (mouseY - 0.5) * speed;
        orb.style.transform = `translate(${x}px, ${y}px)`;
    });
});

// Feature cards 3D effect
const featureCards = document.querySelectorAll('.feature-card');

featureCards.forEach(card => {
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

// Orchestration Cortex Animation
const cortex = document.querySelector('.orchestration-cortex');
const fleetContainer = document.getElementById('agent-fleet');
const linksContainer = document.getElementById('cortex-links');
const hologramData = document.querySelector('.hologram-data');

if (cortex) {
    const agents = [];
    const numAgents = 15;
    const missions = [
        'MISSION: CLAUDE_REFactor',
        'MISSION: GEMINI_STRAT',
        'MISSION: QWEN_OPTIMIZE',
        'MISSION: KILO_DEPLOY',
        'MISSION: CLINE_ARCHITECT',
        'MISSION: OPENCLAW_SUBMIT',
        'MISSION: DEEPSEEK_ANALYZE',
        'MISSION: OLLAMA_LOCAL_SYNC'
    ];

    // Initialize Fleet
    for (let i = 0; i < numAgents; i++) {
        const node = document.createElement('div');
        node.className = 'agent-node';
        fleetContainer.appendChild(node);

        agents.push({
            el: node,
            angle: Math.random() * Math.PI * 2,
            radius: 120 + Math.random() * 100,
            speed: 0.005 + Math.random() * 0.015,
            active: false
        });
    }

    // SVG for links
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    linksContainer.appendChild(svg);

    function animateFleet() {
        const centerX = 250;
        const centerY = 250;

        // Clear previous links
        svg.innerHTML = '';

        agents.forEach((agent, i) => {
            agent.angle += agent.speed;
            const x = centerX + Math.cos(agent.angle) * agent.radius;
            const y = centerY + Math.sin(agent.angle) * agent.radius;

            agent.el.style.left = `${x - 6}px`;
            agent.el.style.top = `${y - 6}px`;

            if (agent.active) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', centerX);
                line.setAttribute('y1', centerY);
                line.setAttribute('x2', x);
                line.setAttribute('y2', y);
                line.setAttribute('class', 'link-line active');
                svg.appendChild(line);
            }
        });

        requestAnimationFrame(animateFleet);
    }

    animateFleet();

    // Orchestration Logic: Activate random agents
    setInterval(() => {
        const randomIndex = Math.floor(Math.random() * agents.length);
        const agent = agents[randomIndex];

        agent.active = true;
        agent.el.classList.add('active');

        // Update hologram
        if (Math.random() > 0.7) {
            const missionLines = hologramData.querySelectorAll('.data-line');
            missionLines[2].textContent = missions[Math.floor(Math.random() * missions.length)];
            missionLines[2].style.color = '#ff006e';
            setTimeout(() => {
                missionLines[2].style.color = '';
            }, 500);
        }

        setTimeout(() => {
            agent.active = false;
            agent.el.classList.remove('active');
        }, 1000 + Math.random() * 2000);
    }, 800);

    // Cortex Core interactions
    const cortexCore = document.querySelector('.cortex-core');
    cortexCore.addEventListener('click', () => {
        // Massive burst
        agents.forEach(agent => {
            agent.active = true;
            agent.el.classList.add('active');
            setTimeout(() => {
                agent.active = false;
                agent.el.classList.remove('active');
            }, 1000);
        });

        const originalText = hologramData.querySelector('.data-line:first-child').textContent;
        hologramData.querySelector('.data-line:first-child').textContent = 'STATUS: OVERDRIVE';
        hologramData.querySelector('.data-line:first-child').style.color = '#ff006e';

        setTimeout(() => {
            hologramData.querySelector('.data-line:first-child').textContent = originalText;
            hologramData.querySelector('.data-line:first-child').style.color = '';
        }, 1000);
    });
}

function createParticle(element) {
    const particle = document.createElement('div');
    const rect = element.getBoundingClientRect();

    particle.style.cssText = `
        position: fixed;
        width: 10px;
        height: 10px;
        background: ${getRandomColor()};
        border-radius: 50%;
        pointer-events: none;
        z-index: 1000;
        left: ${rect.left + rect.width / 2}px;
        top: ${rect.top + rect.height / 2}px;
        box-shadow: 0 0 10px ${getRandomColor()};
    `;

    document.body.appendChild(particle);

    const angle = Math.random() * Math.PI * 2;
    const velocity = 5 + Math.random() * 10;
    const vx = Math.cos(angle) * velocity;
    const vy = Math.sin(angle) * velocity;

    let opacity = 1;
    let posX = 0;
    let posY = 0;

    function animate() {
        posX += vx;
        posY += vy;
        opacity -= 0.02;

        particle.style.transform = `translate(${posX}px, ${posY}px)`;
        particle.style.opacity = opacity;

        if (opacity > 0) {
            requestAnimationFrame(animate);
        } else {
            particle.remove();
        }
    }

    animate();
}

function getRandomColor() {
    const colors = ['#ff006e', '#00fff5', '#b537f2', '#3b82f6'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Typing effect for hero badge
const heroBadge = document.querySelector('.hero-badge span');
if (heroBadge) {
    const text = heroBadge.textContent;
    heroBadge.textContent = '';

    let i = 0;
    function typeWriter() {
        if (i < text.length) {
            heroBadge.textContent += text.charAt(i);
            i++;
            setTimeout(typeWriter, 100);
        }
    }

    setTimeout(typeWriter, 1000);
}

// Add loading animation
window.addEventListener('load', () => {
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease';
        document.body.style.opacity = '1';
    }, 100);
});

// Console Easter egg
console.log('%c🧠 OverMind-MCP', 'font-size: 30px; font-weight: bold; background: linear-gradient(135deg, #ff006e, #b537f2, #00fff5); -webkit-background-clip: text; -webkit-text-fill-color: transparent;');
console.log('%cThe future of AI orchestration', 'font-size: 16px; color: #00fff5;');
console.log('%cJoin us on Discord: https://discord.gg/4AR82phtBz', 'font-size: 12px; color: #b537f2;');

// Performance optimization: Pause matrix animation when not visible
let matrixAnimation = true;

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        matrixAnimation = false;
    } else {
        matrixAnimation = true;
    }
});

// Add sound effect on button hover (optional - commented out)
/*
const buttons = document.querySelectorAll('.btn');

buttons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
        // Add your sound effect here
    });
});
*/

// Dynamic year in footer
const yearSpan = document.querySelector('.footer-bottom p');
if (yearSpan && yearSpan.textContent.includes('2026')) {
    const currentYear = new Date().getFullYear();
    yearSpan.textContent = yearSpan.textContent.replace('2026', currentYear);
}
