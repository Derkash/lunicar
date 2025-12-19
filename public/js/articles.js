// ============ ARTICLES PAGE - SEO OPTIMIZED ============
document.addEventListener('DOMContentLoaded', () => {
    loadAllArticles();
    initFilters();
    initNewsletter();
    initCategoryLinks();
});

let allArticles = [];
let currentPage = 1;
const articlesPerPage = 10;

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
        renderPopularArticles(allArticles);
        updateSchemaItemList(allArticles);

    } catch (error) {
        console.error('Erreur:', error);
        loading.innerHTML = '<p>Erreur lors du chargement des articles</p>';
    }
}

function renderArticles(articles, page = 1) {
    const grid = document.getElementById('articlesGrid');
    const emptyState = document.getElementById('emptyState');
    const pagination = document.getElementById('pagination');

    if (articles.length === 0) {
        grid.innerHTML = '';
        emptyState.style.display = 'block';
        pagination.innerHTML = '';
        return;
    }

    emptyState.style.display = 'none';

    // Pagination
    const totalPages = Math.ceil(articles.length / articlesPerPage);
    const startIndex = (page - 1) * articlesPerPage;
    const endIndex = startIndex + articlesPerPage;
    const paginatedArticles = articles.slice(startIndex, endIndex);

    grid.innerHTML = paginatedArticles.map(article => `
        <article class="article-card">
            <div class="article-card-image">
                ${article.image ? `<img src="${article.image}" alt="${article.titre}" loading="lazy">` : article.emoji || '📰'}
            </div>
            <div class="article-card-content">
                <div class="article-card-meta">
                    <span class="article-category">${article.categorie}</span>
                    <time datetime="${formatDateISO(article.date)}">${article.date}</time>
                </div>
                <h3><a href="/article/${article.slug}">${article.titre}</a></h3>
                <p class="article-excerpt">${truncateText(article.extrait, 150)}</p>
                <div class="article-card-footer">
                    <span class="read-time">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                        ${article.tempsLecture} min
                    </span>
                    <a href="/article/${article.slug}" class="read-more">Lire la suite</a>
                </div>
            </div>
        </article>
    `).join('');

    // Render pagination if needed
    if (totalPages > 1) {
        renderPagination(articles, page, totalPages);
    } else {
        pagination.innerHTML = '';
    }
}

function renderPagination(articles, currentPage, totalPages) {
    const pagination = document.getElementById('pagination');

    let html = '';

    // Previous button
    html += `<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1}, '${getCurrentFilter()}')">&laquo; Precedent</button>`;

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i}, '${getCurrentFilter()}')">${i}</button>`;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
            html += `<span class="pagination-dots">...</span>`;
        }
    }

    // Next button
    html += `<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1}, '${getCurrentFilter()}')">Suivant &raquo;</button>`;

    pagination.innerHTML = html;
}

function goToPage(page, filter) {
    currentPage = page;
    const articles = filter === 'all' ? allArticles : allArticles.filter(a =>
        a.categorieSlug === filter || a.categorie.toLowerCase() === filter
    );
    renderArticles(articles, page);
    window.scrollTo({ top: document.querySelector('.articles-grid').offsetTop - 100, behavior: 'smooth' });
}

function getCurrentFilter() {
    const activeBtn = document.querySelector('.filter-btn.active');
    return activeBtn ? activeBtn.dataset.filter : 'all';
}

function renderPopularArticles(articles) {
    const container = document.getElementById('popularArticles');
    if (!container) return;

    // Take first 3 articles as "popular"
    const popular = articles.slice(0, 3);

    container.innerHTML = popular.map(article => `
        <div class="popular-article">
            <div class="popular-article-image">${article.emoji || '📰'}</div>
            <div class="popular-article-content">
                <h4><a href="/article/${article.slug}">${truncateText(article.titre, 50)}</a></h4>
                <span class="popular-article-meta">${article.tempsLecture} min de lecture</span>
            </div>
        </div>
    `).join('');
}

function updateSchemaItemList(articles) {
    const schemaScript = document.getElementById('schemaItemList');
    if (!schemaScript) return;

    const schema = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Articles LUNICAR",
        "description": "Conseils et actualites pour vendre votre voiture",
        "numberOfItems": articles.length,
        "itemListElement": articles.slice(0, 10).map((article, index) => ({
            "@type": "ListItem",
            "position": index + 1,
            "url": `https://lunicar.fr/article/${article.slug}`,
            "name": article.titre
        }))
    };

    schemaScript.textContent = JSON.stringify(schema, null, 2);
}

function initFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const filter = btn.dataset.filter;
            currentPage = 1;

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

function initCategoryLinks() {
    const categoryLinks = document.querySelectorAll('.category-list a');

    categoryLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const filter = link.dataset.filter;

            // Update filter buttons
            const filterBtns = document.querySelectorAll('.filter-btn');
            filterBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });

            currentPage = 1;
            const filtered = allArticles.filter(a =>
                a.categorieSlug === filter || a.categorie.toLowerCase() === filter
            );
            renderArticles(filtered);

            // Scroll to articles
            document.querySelector('.articles-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        if (window.AppUtils) {
            window.AppUtils.showNotification('Merci pour votre inscription !', 'success');
        }
        form.reset();
    });
}

// Utility functions
function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

function formatDateISO(dateStr) {
    // Convert "15 decembre 2024" to "2024-12-15"
    const months = {
        'janvier': '01', 'fevrier': '02', 'mars': '03', 'avril': '04',
        'mai': '05', 'juin': '06', 'juillet': '07', 'aout': '08',
        'septembre': '09', 'octobre': '10', 'novembre': '11', 'decembre': '12'
    };

    const parts = dateStr.toLowerCase().split(' ');
    if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = months[parts[1]] || '01';
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }
    return new Date().toISOString().split('T')[0];
}

// Expose goToPage globally for pagination onclick
window.goToPage = goToPage;
