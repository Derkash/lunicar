// ============ ARTICLE SINGLE - SEO OPTIMIZED ============
document.addEventListener('DOMContentLoaded', () => {
    loadArticle();
});

const baseUrl = 'https://lunicar.fr';

async function loadArticle() {
    const slug = window.location.pathname.split('/').pop();
    const headerEl = document.getElementById('articleHeader');
    const bodyEl = document.getElementById('articleBody');

    try {
        const response = await fetch(`/api/articles/${slug}`);

        if (!response.ok) {
            throw new Error('Article non trouve');
        }

        const article = await response.json();

        // Update SEO meta tags
        updateSEOMeta(article, slug);

        // Update breadcrumb
        updateBreadcrumb(article);

        // Display article header
        headerEl.innerHTML = `
            <span class="article-category">${article.categorie}</span>
            <h1 itemprop="headline">${article.titre}</h1>
            <div class="article-meta-full">
                <time itemprop="datePublished" datetime="${formatDateISO(article.date)}">
                    Publie le ${article.date}
                </time>
                ${article.dateModified ? `
                <time itemprop="dateModified" datetime="${formatDateISO(article.dateModified)}">
                    Mis a jour le ${article.dateModified}
                </time>
                ` : ''}
                <span class="read-time">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                    ${article.tempsLecture} min de lecture
                </span>
            </div>
            ${article.image ? `
            <div class="article-featured-image">
                <img itemprop="image" src="${article.image}" alt="${article.imageAlt || article.titre}" loading="lazy">
            </div>
            ` : ''}
        `;

        // Display article content
        bodyEl.innerHTML = `
            <div class="article-content">
                ${article.contenu}
            </div>
        `;

        // Generate table of contents if article is long
        generateTableOfContents(article.contenu);

        // Display tags
        displayTags(article);

        // Update author name
        const authorEl = document.getElementById('authorName');
        if (authorEl && article.auteur) {
            authorEl.querySelector('[itemprop="name"]').textContent = article.auteur;
        }

        // Load related articles
        loadRelatedArticles(article.categorieSlug, slug);
        loadRelatedArticlesSidebar(article.categorieSlug, slug);

        // Add IDs to headings for TOC links
        addHeadingIds();

    } catch (error) {
        console.error('Erreur:', error);
        bodyEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">😕</div>
                <h3>Article non trouve</h3>
                <p>L'article que vous recherchez n'existe pas ou a ete supprime.</p>
                <a href="/articles" class="btn btn-primary" style="margin-top: 20px;">Voir tous les articles</a>
            </div>
        `;
    }
}

function updateSEOMeta(article, slug) {
    const articleUrl = `${baseUrl}/article/${slug}`;
    const imageUrl = article.image || `${baseUrl}/images/og-article.jpg`;

    // Update page title
    document.title = article.metaTitle || `${article.titre} | LUNICAR`;

    // Update meta description
    const metaDesc = document.getElementById('metaDescription');
    if (metaDesc) {
        metaDesc.content = article.metaDescription || article.extrait;
    }

    // Update canonical URL
    const canonical = document.getElementById('canonicalUrl');
    if (canonical) canonical.href = articleUrl;

    // Update Open Graph
    const ogUrl = document.getElementById('ogUrl');
    const ogTitle = document.getElementById('ogTitle');
    const ogDescription = document.getElementById('ogDescription');
    const ogImage = document.getElementById('ogImage');

    if (ogUrl) ogUrl.content = articleUrl;
    if (ogTitle) ogTitle.content = article.titre;
    if (ogDescription) ogDescription.content = article.extrait;
    if (ogImage) ogImage.content = imageUrl;

    // Update Twitter Card
    const twitterUrl = document.getElementById('twitterUrl');
    const twitterTitle = document.getElementById('twitterTitle');
    const twitterDescription = document.getElementById('twitterDescription');
    const twitterImage = document.getElementById('twitterImage');

    if (twitterUrl) twitterUrl.content = articleUrl;
    if (twitterTitle) twitterTitle.content = article.titre;
    if (twitterDescription) twitterDescription.content = article.extrait;
    if (twitterImage) twitterImage.content = imageUrl;

    // Update Schema.org BlogPosting
    const schemaBlogPosting = document.getElementById('schemaBlogPosting');
    if (schemaBlogPosting) {
        const schema = {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "mainEntityOfPage": {
                "@type": "WebPage",
                "@id": articleUrl
            },
            "headline": article.titre,
            "description": article.metaDescription || article.extrait,
            "image": imageUrl,
            "author": {
                "@type": "Organization",
                "name": article.auteur || "LUNICAR",
                "url": baseUrl
            },
            "publisher": {
                "@type": "Organization",
                "name": "LUNICAR",
                "logo": {
                    "@type": "ImageObject",
                    "url": `${baseUrl}/images/logo.png`
                }
            },
            "datePublished": formatDateISO(article.date),
            "dateModified": article.dateModified ? formatDateISO(article.dateModified) : formatDateISO(article.date)
        };
        schemaBlogPosting.textContent = JSON.stringify(schema, null, 2);
    }

    // Update Schema.org Breadcrumb
    const schemaBreadcrumb = document.getElementById('schemaBreadcrumb');
    if (schemaBreadcrumb) {
        const schema = {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Accueil", "item": `${baseUrl}/`},
                {"@type": "ListItem", "position": 2, "name": "Articles", "item": `${baseUrl}/articles`},
                {"@type": "ListItem", "position": 3, "name": article.categorie, "item": `${baseUrl}/articles?cat=${article.categorieSlug}`},
                {"@type": "ListItem", "position": 4, "name": article.titre, "item": articleUrl}
            ]
        };
        schemaBreadcrumb.textContent = JSON.stringify(schema, null, 2);
    }
}

function updateBreadcrumb(article) {
    const breadcrumbCategory = document.getElementById('breadcrumbCategory');
    const breadcrumbTitle = document.getElementById('breadcrumbTitle');

    if (breadcrumbCategory) {
        breadcrumbCategory.innerHTML = `<a href="/articles?cat=${article.categorieSlug}">${article.categorie}</a>`;
    }
    if (breadcrumbTitle) {
        breadcrumbTitle.textContent = truncateText(article.titre, 40);
    }
}

function generateTableOfContents(content) {
    const tocContainer = document.getElementById('articleToc');
    const tocList = document.getElementById('tocList');

    if (!tocContainer || !tocList) return;

    // Count words to determine if TOC is needed (> 1000 words)
    const wordCount = content.replace(/<[^>]*>/g, '').split(/\s+/).length;

    if (wordCount < 500) return;

    // Extract h2 headings
    const headings = content.match(/<h2[^>]*>([^<]+)<\/h2>/gi);

    if (!headings || headings.length < 2) return;

    tocList.innerHTML = headings.map((heading, index) => {
        const text = heading.replace(/<[^>]*>/g, '');
        const id = `section-${index + 1}`;
        return `<li><a href="#${id}">${text}</a></li>`;
    }).join('');

    tocContainer.style.display = 'block';
}

function addHeadingIds() {
    const articleBody = document.getElementById('articleBody');
    if (!articleBody) return;

    const headings = articleBody.querySelectorAll('h2');
    headings.forEach((heading, index) => {
        heading.id = `section-${index + 1}`;
    });
}

function displayTags(article) {
    const tagsContainer = document.getElementById('articleTags');
    if (!tagsContainer) return;

    const tags = article.tags || [article.categorie];

    tagsContainer.innerHTML = tags.map(tag =>
        `<a href="/articles?cat=${tag.toLowerCase()}" class="article-tag">${tag}</a>`
    ).join('');
}

async function loadRelatedArticles(categorie, currentSlug) {
    const container = document.getElementById('relatedArticles');
    if (!container) return;

    try {
        const response = await fetch('/api/articles');
        const articles = await response.json();

        // Filter articles from same category, excluding current
        let related = articles.filter(a => a.categorieSlug === categorie && a.slug !== currentSlug);

        // If not enough from same category, add other articles
        if (related.length < 3) {
            const others = articles.filter(a => a.slug !== currentSlug && a.categorieSlug !== categorie);
            related = [...related, ...others].slice(0, 3);
        } else {
            related = related.slice(0, 3);
        }

        if (related.length === 0) {
            container.closest('.related-articles-section').style.display = 'none';
            return;
        }

        container.innerHTML = related.map(article => `
            <article class="article-card">
                <div class="article-card-image">
                    ${article.image ? `<img src="${article.image}" alt="${article.titre}" loading="lazy">` : article.emoji || '📰'}
                </div>
                <div class="article-card-content">
                    <div class="article-card-meta">
                        <span class="article-category">${article.categorie}</span>
                    </div>
                    <h3><a href="/article/${article.slug}">${article.titre}</a></h3>
                    <p class="article-excerpt">${truncateText(article.extrait, 100)}</p>
                </div>
            </article>
        `).join('');

    } catch (error) {
        console.error('Erreur articles similaires:', error);
        container.closest('.related-articles-section').style.display = 'none';
    }
}

async function loadRelatedArticlesSidebar(categorie, currentSlug) {
    const container = document.getElementById('relatedArticlesSidebar');
    if (!container) return;

    try {
        const response = await fetch('/api/articles');
        const articles = await response.json();

        const related = articles
            .filter(a => a.slug !== currentSlug)
            .slice(0, 3);

        if (related.length === 0) {
            container.closest('.sidebar-section').style.display = 'none';
            return;
        }

        container.innerHTML = related.map(article => `
            <a href="/article/${article.slug}" class="related-article-item">
                <h4>${truncateText(article.titre, 60)}</h4>
                <span>${article.tempsLecture} min de lecture</span>
            </a>
        `).join('');

    } catch (error) {
        console.error('Erreur articles sidebar:', error);
    }
}

function shareArticle(platform) {
    const url = encodeURIComponent(window.location.href);
    const title = encodeURIComponent(document.title);
    const text = encodeURIComponent(document.querySelector('meta[name="description"]')?.content || '');

    const urls = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
        twitter: `https://twitter.com/intent/tweet?url=${url}&text=${title}`,
        linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${url}&title=${title}`,
        whatsapp: `https://wa.me/?text=${title}%20${url}`
    };

    if (urls[platform]) {
        window.open(urls[platform], '_blank', 'width=600,height=400');
    }
}

function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
        if (window.AppUtils) {
            window.AppUtils.showNotification('Lien copie dans le presse-papiers !', 'success');
        } else {
            alert('Lien copie !');
        }
    }).catch(() => {
        // Fallback for older browsers
        const input = document.createElement('input');
        input.value = window.location.href;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        alert('Lien copie !');
    });
}

// Utility functions
function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

function formatDateISO(dateStr) {
    if (!dateStr) return new Date().toISOString().split('T')[0];

    const months = {
        'janvier': '01', 'fevrier': '02', 'mars': '03', 'avril': '04',
        'mai': '05', 'juin': '06', 'juillet': '07', 'aout': '08',
        'septembre': '09', 'octobre': '10', 'novembre': '11', 'decembre': '12'
    };

    const parts = dateStr.toLowerCase().replace(/é/g, 'e').split(' ');
    if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = months[parts[1]] || '01';
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }
    return new Date().toISOString().split('T')[0];
}

// Expose share functions globally
window.shareArticle = shareArticle;
window.copyLink = copyLink;
