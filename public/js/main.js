// ============ UTILITIES ============
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// ============ HEADER SCROLL ============
function initHeader() {
    const header = $('.header');
    if (!header) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });
}

// ============ MOBILE MENU ============
function initMobileMenu() {
    const menuBtn = $('.mobile-menu-btn');
    const navLinks = $('.nav-links');
    if (!menuBtn || !navLinks) return;

    menuBtn.addEventListener('click', () => {
        navLinks.classList.toggle('active');
        menuBtn.classList.toggle('active');
    });

    // Fermer le menu au clic sur un lien
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('active');
            menuBtn.classList.remove('active');
        });
    });
}

// ============ VALIDATION PLAQUE ============
function validatePlaque(plaque) {
    const cleaned = plaque.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const nouveauFormat = /^[A-Z]{2}[0-9]{3}[A-Z]{2}$/;
    const ancienFormat = /^[0-9]{1,4}[A-Z]{2,3}[0-9]{2}$/;
    return nouveauFormat.test(cleaned) || ancienFormat.test(cleaned);
}

function formatPlaque(value) {
    let cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Format nouveau : AA-123-AA
    if (cleaned.length <= 7) {
        let formatted = '';
        for (let i = 0; i < cleaned.length; i++) {
            if (i === 2 || i === 5) formatted += '-';
            formatted += cleaned[i];
        }
        return formatted;
    }
    return cleaned;
}

function initPlaqueInput() {
    const input = $('#plaqueInput');
    const form = $('#plaqueForm');
    if (!input) return;

    input.addEventListener('input', (e) => {
        const formatted = formatPlaque(e.target.value);
        e.target.value = formatted;

        const cleaned = formatted.replace(/-/g, '');
        if (cleaned.length >= 7) {
            if (validatePlaque(cleaned)) {
                input.classList.add('valid');
                input.classList.remove('invalid');
            } else {
                input.classList.add('invalid');
                input.classList.remove('valid');
            }
        } else {
            input.classList.remove('valid', 'invalid');
        }
    });

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const plaque = input.value.replace(/-/g, '');

            if (validatePlaque(plaque)) {
                window.location.href = `/reprise?plaque=${encodeURIComponent(input.value)}`;
            } else {
                input.classList.add('invalid');
                showNotification('Veuillez entrer une plaque d\'immatriculation valide', 'error');
            }
        });
    }
}

// ============ ANIMATIONS SCROLL ============
function initScrollAnimations() {
    const elements = $$('.animate-on-scroll');
    if (!elements.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    elements.forEach(el => observer.observe(el));
}

// ============ CHARGEMENT ARTICLES ============
async function loadArticles(limit = 3) {
    const grid = $('#articlesGrid');
    if (!grid) return;

    try {
        const response = await fetch('/api/articles');
        const articles = await response.json();

        const displayArticles = articles.slice(0, limit);

        grid.innerHTML = displayArticles.map(article => `
            <article class="article-card animate-on-scroll">
                <div class="article-image">${article.emoji || '📰'}</div>
                <div class="article-content">
                    <span class="article-category">${article.categorie}</span>
                    <h3><a href="/article/${article.slug}">${article.titre}</a></h3>
                    <p class="article-excerpt">${article.extrait}</p>
                    <div class="article-meta">
                        <span>${article.date}</span>
                        <span>${article.tempsLecture} min de lecture</span>
                    </div>
                </div>
            </article>
        `).join('');

        // Réinitialiser les animations pour les nouveaux éléments
        initScrollAnimations();
    } catch (error) {
        console.error('Erreur chargement articles:', error);
        grid.innerHTML = '<p>Erreur lors du chargement des articles</p>';
    }
}

// ============ NOTIFICATIONS ============
function showNotification(message, type = 'success') {
    // Supprimer notification existante
    const existing = $('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()">&times;</button>
    `;

    // Styles inline pour la notification
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 15px;
        z-index: 9999;
        animation: slideIn 0.3s ease;
        background: ${type === 'success' ? '#10b981' : '#ef4444'};
        color: white;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    `;

    document.body.appendChild(notification);

    // Auto-suppression après 5 secondes
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    initMobileMenu();
    initPlaqueInput();
    initScrollAnimations();
    loadArticles(3);
});

// Export pour utilisation dans d'autres pages
window.AppUtils = {
    validatePlaque,
    formatPlaque,
    showNotification,
    initScrollAnimations
};
