// ===== MATRIX RAIN EFFECT =====
const canvas = document.getElementById('matrix-rain');
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
    ctx.fillStyle = 'rgba(10, 14, 39, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#0F0';
    ctx.font = fontSize + 'px monospace';

    for (let i = 0; i < drops.length; i++) {
        const text = charArray[Math.floor(Math.random() * charArray.length)];
        ctx.fillStyle = `rgba(0, 240, 255, ${Math.random() * 0.5 + 0.5})`;
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
            drops[i] = 0;
        }
        drops[i]++;
    }
}

setInterval(drawMatrix, 35);

// ===== PARALLAX EFFECT ON MOUSE MOVE =====
document.addEventListener('mousemove', (e) => {
    const orbs = document.querySelectorAll('.orb');
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;

    orbs.forEach((orb, index) => {
        const speed = (index + 1) * 20;
        const xOffset = (x - 0.5) * speed;
        const yOffset = (y - 0.5) * speed;
        orb.style.transform = `translate(${xOffset}px, ${yOffset}px)`;
    });
});

// ===== SMOOTH SCROLL =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
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

// ===== ANIMATED COUNTER =====
function animateCounter(element, target) {
    let current = 0;
    const increment = target / 100;
    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            element.textContent = target + (element.parentElement.querySelector('.stat-label').textContent === 'Version' ? '.1.1' : '%');
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current) + (target === 1 ? '' : '%');
        }
    }, 20);
}

// ===== INTERSECTION OBSERVER FOR ANIMATIONS =====
const observerOptions = {
    threshold: 0.5,
    rootMargin: '0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            if (entry.target.classList.contains('stat-value')) {
                const target = parseInt(entry.target.dataset.target);
                animateCounter(entry.target, target);
                observer.unobserve(entry.target);
            }
        }
    });
}, observerOptions);

document.querySelectorAll('.stat-value').forEach(stat => {
    observer.observe(stat);
});

// ===== COPY INSTALL COMMAND =====
function copyInstall() {
    const command = 'npm install -g overmind-mcp';
    navigator.clipboard.writeText(command).then(() => {
        const copyBtn = document.querySelector('.install-copy');
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<span class="copy-icon">✅</span><span class="copy-text">Copied!</span>';
        setTimeout(() => {
            copyBtn.innerHTML = originalText;
        }, 2000);
    });
}

// ===== 3D CARD EFFECT =====
document.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = (y - centerY) / 10;
        const rotateY = (centerX - x) / 10;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.05)`;
    });

    card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale(1)';
    });
});

// ===== RESIZE HANDLER =====
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// ===== ADD TYPING EFFECT TO HERO =====
const heroSubtitle = document.querySelector('.hero-subtitle');
const originalText = heroSubtitle.textContent;
heroSubtitle.textContent = '';
let charIndex = 0;

function typeText() {
    if (charIndex < originalText.length) {
        heroSubtitle.textContent += originalText.charAt(charIndex);
        charIndex++;
        setTimeout(typeText, 50);
    }
}

setTimeout(typeText, 500);

// ===== GLITCH EFFECT ON HOVER =====
document.querySelectorAll('.glitch-effect').forEach(element => {
    element.addEventListener('mouseenter', () => {
        element.style.animation = 'none';
        setTimeout(() => {
            element.style.animation = '';
        }, 10);
    });
});

// ===== PERFORMANCE OPTIMIZATION =====
let ticking = false;
document.addEventListener('scroll', () => {
    if (!ticking) {
        window.requestAnimationFrame(() => {
            // Parallax effect on scroll
            const scrolled = window.pageYOffset;
            const orbs = document.querySelectorAll('.orb');
            orbs.forEach((orb, index) => {
                const speed = (index + 1) * 0.1;
                orb.style.transform = `translateY(${scrolled * speed}px)`;
            });
            ticking = false;
        });
        ticking = true;
    }
});

console.log('%c🚀 OVERMIND MCP', 'color: #00f0ff; font-size: 24px; font-weight: bold; text-shadow: 0 0 10px #00f0ff;');
console.log('%cAdvanced AI Integration Server', 'color: #8b9dc3; font-size: 14px;');
