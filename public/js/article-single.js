// ============ ARTICLE SINGLE ============
document.addEventListener('DOMContentLoaded', () => {
    loadArticle();
});

async function loadArticle() {
    const slug = window.location.pathname.split('/').pop();
    const headerEl = document.getElementById('articleHeader');
    const bodyEl = document.getElementById('articleBody');

    try {
        const response = await fetch(`/api/articles/${slug}`);

        if (!response.ok) {
            throw new Error('Article non trouvé');
        }

        const article = await response.json();

        // Mettre à jour le titre de la page
        document.title = `${article.titre} - LUNICAR`;

        // Afficher le header
        headerEl.innerHTML = `
            <span class="article-category">${article.categorie}</span>
            <h1>${article.titre}</h1>
            <div class="article-meta-full">
                <span>📅 ${article.date}</span>
                <span>⏱️ ${article.tempsLecture} min de lecture</span>
                <span>✍️ ${article.auteur || 'Équipe LUNICAR'}</span>
            </div>
        `;

        // Afficher le contenu
        bodyEl.innerHTML = `
            <div class="article-content">
                ${article.contenu}
            </div>
            <div class="article-share">
                <span>Partager :</span>
                <button class="share-btn" onclick="shareArticle('facebook')" title="Facebook">f</button>
                <button class="share-btn" onclick="shareArticle('twitter')" title="Twitter">t</button>
                <button class="share-btn" onclick="shareArticle('linkedin')" title="LinkedIn">in</button>
                <button class="share-btn" onclick="copyLink()" title="Copier le lien">🔗</button>
            </div>
        `;

        // Charger les articles similaires
        loadRelatedArticles(article.categorieSlug, slug);

    } catch (error) {
        console.error('Erreur:', error);
        bodyEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">😕</div>
                <h3>Article non trouvé</h3>
                <p>L'article que vous recherchez n'existe pas ou a été supprimé.</p>
                <a href="/articles" class="btn btn-primary" style="margin-top: 20px;">Voir tous les articles</a>
            </div>
        `;
    }
}

async function loadRelatedArticles(categorie, currentSlug) {
    const container = document.getElementById('relatedArticles');
    if (!container) return;

    try {
        const response = await fetch('/api/articles');
        const articles = await response.json();

        // Filtrer les articles de la même catégorie, sauf l'actuel
        const related = articles
            .filter(a => a.slug !== currentSlug)
            .slice(0, 3);

        if (related.length === 0) {
            container.closest('.related-articles').style.display = 'none';
            return;
        }

        container.innerHTML = related.map(article => `
            <article class="article-card">
                <div class="article-image">${article.emoji || '📰'}</div>
                <div class="article-content">
                    <span class="article-category">${article.categorie}</span>
                    <h3><a href="/article/${article.slug}">${article.titre}</a></h3>
                    <p class="article-excerpt">${article.extrait}</p>
                </div>
            </article>
        `).join('');

    } catch (error) {
        console.error('Erreur articles similaires:', error);
        container.closest('.related-articles').style.display = 'none';
    }
}

function shareArticle(platform) {
    const url = encodeURIComponent(window.location.href);
    const title = encodeURIComponent(document.title);

    const urls = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
        twitter: `https://twitter.com/intent/tweet?url=${url}&text=${title}`,
        linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${url}&title=${title}`
    };

    if (urls[platform]) {
        window.open(urls[platform], '_blank', 'width=600,height=400');
    }
}

function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
        window.AppUtils.showNotification('Lien copié !', 'success');
    });
}
