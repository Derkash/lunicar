// ============ ARTICLES PAGE ============
document.addEventListener('DOMContentLoaded', () => {
    loadAllArticles();
    initFilters();
    initNewsletter();
});

let allArticles = [];

async function loadAllArticles() {
    const grid = document.getElementById('articlesGrid');
    const loading = document.getElementById('loading');
    const emptyState = document.getElementById('emptyState');

    if (!grid) return;

    try {
        const response = await fetch('/api/articles');
        allArticles = await response.json();

        loading.style.display = 'none';

        if (allArticles.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        renderArticles(allArticles);
    } catch (error) {
        console.error('Erreur:', error);
        loading.innerHTML = '<p>Erreur lors du chargement des articles</p>';
    }
}

function renderArticles(articles) {
    const grid = document.getElementById('articlesGrid');
    const emptyState = document.getElementById('emptyState');

    if (articles.length === 0) {
        grid.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    grid.innerHTML = articles.map(article => `
        <article class="article-card">
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
}

function initFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Activer le bouton
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const filter = btn.dataset.filter;

            if (filter === 'all') {
                renderArticles(allArticles);
            } else {
                const filtered = allArticles.filter(a =>
                    a.categorieSlug === filter || a.categorie.toLowerCase() === filter
                );
                renderArticles(filtered);
            }
        });
    });
}

function initNewsletter() {
    const form = document.getElementById('newsletterForm');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = form.querySelector('input[type="email"]').value;

        // Simulation d'inscription
        window.AppUtils.showNotification('Merci pour votre inscription !', 'success');
        form.reset();
    });
}
