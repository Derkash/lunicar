// ============ REPRISE FORM ============
document.addEventListener('DOMContentLoaded', () => {
    initYearSelect();
    initPlaqueFromURL();
    initFormSteps();
    initFileUpload();
    initFormSubmit();
});

// Remplir le select des années
function initYearSelect() {
    const select = document.getElementById('annee');
    if (!select) return;

    const currentYear = new Date().getFullYear();
    for (let year = currentYear; year >= 1990; year--) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        select.appendChild(option);
    }
}

// Récupérer la plaque depuis l'URL
function initPlaqueFromURL() {
    const params = new URLSearchParams(window.location.search);
    const plaque = params.get('plaque');
    if (plaque) {
        const input = document.getElementById('plaque');
        if (input) {
            input.value = plaque;
        }
    }
}

// Gestion des étapes du formulaire
function initFormSteps() {
    const form = document.getElementById('repriseForm');
    if (!form) return;

    let currentStep = 1;
    const totalSteps = 4;

    // Boutons suivant
    document.querySelectorAll('.btn-next').forEach(btn => {
        btn.addEventListener('click', () => {
            if (validateStep(currentStep)) {
                goToStep(currentStep + 1);
            }
        });
    });

    // Boutons précédent
    document.querySelectorAll('.btn-prev').forEach(btn => {
        btn.addEventListener('click', () => {
            goToStep(currentStep - 1);
        });
    });

    function goToStep(step) {
        // Cacher étape actuelle
        document.querySelector(`.form-step[data-step="${currentStep}"]`).classList.remove('active');
        document.querySelector(`.progress-step[data-step="${currentStep}"]`).classList.remove('active');

        // Marquer comme complétée si on avance
        if (step > currentStep) {
            document.querySelector(`.progress-step[data-step="${currentStep}"]`).classList.add('completed');
        }

        // Afficher nouvelle étape
        currentStep = step;
        document.querySelector(`.form-step[data-step="${currentStep}"]`).classList.add('active');
        document.querySelector(`.progress-step[data-step="${currentStep}"]`).classList.add('active');

        // Scroll en haut du formulaire
        document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function validateStep(step) {
        const stepEl = document.querySelector(`.form-step[data-step="${step}"]`);
        const inputs = stepEl.querySelectorAll('[required]');
        let valid = true;

        inputs.forEach(input => {
            if (input.type === 'radio') {
                const name = input.name;
                const checked = stepEl.querySelector(`input[name="${name}"]:checked`);
                if (!checked) {
                    valid = false;
                    highlightRadioGroup(input.name);
                }
            } else if (!input.value.trim()) {
                valid = false;
                input.classList.add('error');
                setTimeout(() => input.classList.remove('error'), 2000);
            }
        });

        // Validation spécifique plaque
        if (step === 1) {
            const plaqueInput = document.getElementById('plaque');
            if (plaqueInput && !window.AppUtils.validatePlaque(plaqueInput.value)) {
                valid = false;
                plaqueInput.classList.add('error');
                window.AppUtils.showNotification('Plaque d\'immatriculation invalide', 'error');
            }
        }

        if (!valid) {
            window.AppUtils.showNotification('Veuillez remplir tous les champs obligatoires', 'error');
        }

        return valid;
    }

    function highlightRadioGroup(name) {
        const group = document.querySelectorAll(`input[name="${name}"]`);
        group.forEach(input => {
            const label = input.nextElementSibling;
            if (label) {
                label.style.borderColor = 'var(--error)';
                setTimeout(() => {
                    label.style.borderColor = '';
                }, 2000);
            }
        });
    }

    // Exposer goToStep pour le succès
    window.goToStep = goToStep;
}

// Gestion upload fichiers
function initFileUpload() {
    const uploadZone = document.getElementById('fileUpload');
    const fileInput = document.getElementById('photos');
    const previewContainer = document.getElementById('filePreview');

    if (!uploadZone || !fileInput) return;

    let uploadedFiles = [];

    // Click pour ouvrir
    uploadZone.addEventListener('click', () => fileInput.click());

    // Drag & Drop
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    // Selection fichiers
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    function handleFiles(files) {
        const maxFiles = 10;
        const maxSize = 5 * 1024 * 1024; // 5 Mo

        Array.from(files).forEach(file => {
            if (uploadedFiles.length >= maxFiles) {
                window.AppUtils.showNotification('Maximum 10 photos autorisées', 'error');
                return;
            }

            if (file.size > maxSize) {
                window.AppUtils.showNotification(`${file.name} est trop volumineux (max 5 Mo)`, 'error');
                return;
            }

            if (!file.type.match(/image\/(jpeg|png|webp)/)) {
                window.AppUtils.showNotification(`${file.name} n'est pas une image valide`, 'error');
                return;
            }

            uploadedFiles.push(file);
            addPreview(file, uploadedFiles.length - 1);
        });

        updateFileInput();
    }

    function addPreview(file, index) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.className = 'file-preview-item';
            div.innerHTML = `
                <img src="${e.target.result}" alt="Preview">
                <button type="button" class="remove-btn" data-index="${index}">&times;</button>
            `;
            previewContainer.appendChild(div);

            // Bouton supprimer
            div.querySelector('.remove-btn').addEventListener('click', () => {
                uploadedFiles.splice(index, 1);
                previewContainer.innerHTML = '';
                uploadedFiles.forEach((f, i) => addPreview(f, i));
                updateFileInput();
            });
        };
        reader.readAsDataURL(file);
    }

    function updateFileInput() {
        const dt = new DataTransfer();
        uploadedFiles.forEach(file => dt.items.add(file));
        fileInput.files = dt.files;
    }
}

// Soumission formulaire
function initFormSubmit() {
    const form = document.getElementById('repriseForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Vérifier RGPD
        const rgpd = document.getElementById('rgpd');
        if (!rgpd.checked) {
            window.AppUtils.showNotification('Veuillez accepter la politique de confidentialité', 'error');
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Envoi en cours...';

        try {
            const formData = new FormData(form);

            const response = await fetch('/api/reprise', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                // Afficher la page de succès
                document.querySelectorAll('.form-step').forEach(step => step.classList.remove('active'));
                document.querySelector('.form-step[data-step="success"]').classList.add('active');
                document.getElementById('referenceNumber').textContent = `REF-${result.id.substring(0, 8).toUpperCase()}`;

                // Marquer toutes les étapes comme complétées
                document.querySelectorAll('.progress-step').forEach(step => {
                    step.classList.add('completed');
                    step.classList.remove('active');
                });
            } else {
                throw new Error(result.error || 'Erreur lors de l\'envoi');
            }
        } catch (error) {
            console.error('Erreur:', error);
            window.AppUtils.showNotification('Une erreur est survenue. Veuillez réessayer.', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Envoyer ma demande';
        }
    });
}
