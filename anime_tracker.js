const pathTracker = require('path');

// ================= VARIÁVEIS LOCAIS & CONTROLE DE ESTADO =================
let _animeRating = 0;
let _animeTempImage = null;
let _editingAnimeId = null;
let _openGroups = new Set();

// ================= HELPER: RESOLVER IMAGEM =================
function resolveAnimePath(imagePath) {
    if (!imagePath) return null;
    if (imagePath.startsWith('http') || imagePath.startsWith('data:')) return imagePath;
    try {
        const absolutePath = pathTracker.resolve(imagePath);
        return `file://${absolutePath}?t=${Date.now()}`;
    } catch(e) { return imagePath; }
}

// ================= RENDERIZAÇÃO DA LISTA (PRINCIPAL) =================
window.renderAnimeList = function() {
    const list = document.getElementById('anime-list-content');
    const statAnimes = document.getElementById('stat-animes-count');
    const statEps = document.getElementById('stat-eps-count');

    if (!list) return;
    list.innerHTML = '';
    
    if (typeof appData === 'undefined' || !appData.animeList || appData.animeList.length === 0) {
        list.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-gray);">Lista vazia.</div>';
        if(statAnimes) statAnimes.innerText = "0";
        if(statEps) statEps.innerText = "0";
        return;
    }

    const groups = {};
    appData.animeList.forEach(anime => {
        const key = anime.name.trim();
        if (!groups[key]) groups[key] = [];
        groups[key].push(anime);
    });

    if(statAnimes) statAnimes.innerText = Object.keys(groups).length;
    if(statEps) statEps.innerText = appData.animeList.length;

    Object.keys(groups).forEach(groupName => {
        const items = groups[groupName];
        const li = document.createElement('li');
        li.className = 'anime-item';
        
        const safeName = encodeURIComponent(groupName);
        
        // Verifica memória de grupos abertos
        const isOpen = _openGroups.has(groupName);
        const displayStyle = isOpen ? 'block !important' : 'none !important';
        const rotation = isOpen ? '90deg' : '0deg';

        // --- CABEÇALHO COM BOTÕES DE AÇÃO ---
        li.innerHTML = `
            <div class="anime-header" onclick="toggleAnimeGroup(this, '${safeName}')" 
                 style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; border-bottom: 1px solid #eee; cursor: pointer; background: rgba(255,255,255,0.03);">
                
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-chevron-right" style="font-size:0.7rem; color:gray; transition:0.2s; transform: rotate(${rotation});"></i> 
                    <span style="font-weight:bold; font-size: 1rem;">${groupName}</span>
                    <span style="font-size:0.8rem; color:gray;">(${items.length})</span>
                </div>

                <div style="display: flex; gap: 5px;">
                    <button onclick="deleteAnimeGroup(event, '${safeName}')"
                            title="Apagar Grupo Inteiro"
                            style="background-color: #ff4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                        <i class="fas fa-trash"></i>
                    </button>

                    <button onclick="event.stopPropagation(); quickAddAnime('${safeName}')"
                            title="Adicionar Episódio"
                            style="background-color: #28a745; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.8rem; display: flex; align-items: center; gap: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                        <i class="fas fa-plus"></i> Add
                    </button>
                </div>
            </div>
            
            <div class="anime-subgroup" style="display: ${displayStyle}; background: rgba(0,0,0,0.02);"></div>
        `;
        
        const subList = li.querySelector('.anime-subgroup');
        
        items.forEach(anime => {
            const childDiv = document.createElement('div');
            childDiv.className = 'anime-child-item';
            childDiv.style.cssText = "display:flex; gap:10px; padding:10px 15px; border-bottom:1px dashed #eee; align-items:center;";
            
            let starsHtml = '';
            for(let i=0; i<anime.rating; i++) starsHtml += '<i class="fas fa-star" style="font-size:0.6rem; color:#ffca28;"></i>';
            
            let thumbSrc = 'https://via.placeholder.com/50x70?text=?';
            if(anime.image) thumbSrc = resolveAnimePath(anime.image);

            const displayTitle = anime.epTitle ? anime.epTitle : (anime.author || '---');
            const displaySub = anime.epTitle ? (anime.author || '') : '';

            childDiv.innerHTML = `
                <img src="${thumbSrc}" style="width:40px; height:56px; border-radius:4px; object-fit:cover; border:1px solid #ccc; flex-shrink:0;">
                
                <div style="flex:1; display:flex; flex-direction:column; justify-content:center; overflow:hidden;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.85rem; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayTitle}</span>
                        <span style="flex-shrink:0;">${starsHtml}</span>
                    </div>
                    ${displaySub ? `<div style="font-size:0.75rem; color:gray;">${displaySub}</div>` : ''}
                    <div style="font-size:0.75rem; font-style:italic; color:gray; margin-top:2px;">"${anime.review || ''}"</div>
                </div>
                
                <div style="margin-left:10px; display:flex; flex-direction:column; gap:5px;">
                    <button class="btn-rural small" style="padding:2px 6px; cursor:pointer; background-color:#2196F3; color:white; border:none; border-radius:3px;" 
                            onclick="editAnimeEntry(event, ${anime.id})" title="Editar">
                        <i class="fas fa-pencil-alt"></i>
                    </button>
                    <button class="btn-rural small danger" style="padding:2px 6px; cursor:pointer;" 
                            onclick="deleteAnimeEntry(event, ${anime.id})" title="Apagar">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            subList.appendChild(childDiv);
        });
        
        list.appendChild(li);
    });
}

// ================= APAGAR GRUPO INTEIRO =================
window.deleteAnimeGroup = function(event, encodedName) {
    if (event) event.stopPropagation(); // Não abrir/fechar ao clicar
    
    const groupName = decodeURIComponent(encodedName);

    const performGroupDelete = () => {
        if(typeof appData !== 'undefined' && appData.animeList) {
            // Remove TODOS os itens com esse nome
            appData.animeList = appData.animeList.filter(a => a.name !== groupName);
            
            // Remove da memória de grupos abertos
            _openGroups.delete(groupName);

            if(typeof saveData === 'function') saveData();
            if(typeof performAutoSave === 'function') performAutoSave();
            
            renderAnimeList();
        }
        const modal = document.getElementById('confirm-modal');
        if(modal) modal.style.display = 'none';
    };

    // Abre modal de confirmação
    const modal = document.getElementById('confirm-modal');
    const msg = document.getElementById('confirm-msg');
    const btnYes = document.getElementById('btn-confirm-action');

    if (modal && btnYes && msg) {
        msg.innerText = `Apagar TODO o grupo "${groupName}" e seus episódios?`;
        
        const newBtn = btnYes.cloneNode(true);
        btnYes.parentNode.replaceChild(newBtn, btnYes);
        newBtn.onclick = performGroupDelete;
        
        modal.style.display = 'flex';
    } else {
        if(confirm(`Apagar grupo "${groupName}"?`)) performGroupDelete();
    }
}

// ================= LÓGICA DE ABRIR/FECHAR =================
window.toggleAnimeGroup = function(header, encodedName) {
    const subgroup = header.nextElementSibling;
    const icon = header.querySelector('.fa-chevron-right');
    const groupName = decodeURIComponent(encodedName);
    
    if(subgroup.style.display.includes('none')) {
        subgroup.style.cssText = "display: block !important; background: rgba(0,0,0,0.02);";
        icon.style.transform = 'rotate(90deg)';
        _openGroups.add(groupName); 
    } else {
        subgroup.style.cssText = "display: none !important; background: rgba(0,0,0,0.02);";
        icon.style.transform = 'rotate(0deg)';
        _openGroups.delete(groupName); 
    }
}

// ================= MODO EDIÇÃO =================
window.editAnimeEntry = function(event, id) {
    if(event) event.stopPropagation();
    
    const entry = appData.animeList.find(a => a.id === id);
    if(!entry) return;

    _editingAnimeId = id; 
    openAnimeModal(true); 

    document.getElementById('anime-name').value = entry.name;
    document.getElementById('anime-ep-title').value = entry.epTitle || '';
    document.getElementById('anime-author').value = entry.author || '';
    document.getElementById('anime-review').value = entry.review || '';
    
    setAnimeRating(entry.rating || 0);
    
    if(entry.image) {
        _animeTempImage = entry.image;
        const imgEl = document.getElementById('anime-preview');
        if(imgEl) {
            imgEl.src = resolveAnimePath(entry.image);
            imgEl.style.display = 'block';
            document.getElementById('anime-upload-text').style.display = 'none';
        }
    }
}

// ================= ADIÇÃO RÁPIDA =================
window.quickAddAnime = function(encodedName) {
    const name = decodeURIComponent(encodedName);
    const existingEntry = appData.animeList.find(a => a.name === name);
    
    if (existingEntry) {
        openAnimeModal(); 
        
        const nameInput = document.getElementById('anime-name');
        const authInput = document.getElementById('anime-author');
        if(nameInput) nameInput.value = existingEntry.name;
        if(authInput) authInput.value = existingEntry.author;
        
        if (existingEntry.image) {
            _animeTempImage = existingEntry.image;
            const imgEl = document.getElementById('anime-preview');
            const txtEl = document.getElementById('anime-upload-text');
            if(imgEl) {
                imgEl.src = resolveAnimePath(existingEntry.image);
                imgEl.style.display = 'block';
            }
            if(txtEl) txtEl.style.display = 'none';
        }
        
        const epInput = document.getElementById('anime-ep-title');
        if(epInput) { epInput.value = ""; epInput.focus(); }
        
        const revInput = document.getElementById('anime-review');
        if(revInput) revInput.value = "";
    }
}

// ================= MODAL & DADOS =================
window.openAnimeModal = function(isEditing = false) {
    const modal = document.getElementById('anime-modal');
    if(modal) modal.style.display = 'flex';
    
    if(!isEditing) {
        _editingAnimeId = null; 
        const inputs = ['anime-name', 'anime-author', 'anime-review', 'anime-ep-title'];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.value = '';
        });
        setAnimeRating(0);
        _animeTempImage = null;
        const img = document.getElementById('anime-preview');
        const txt = document.getElementById('anime-upload-text');
        if(img) { img.src = ''; img.style.display = 'none'; }
        if(txt) { txt.style.display = 'block'; }
    }
    populateAnimeSuggestions();
}

window.closeAnimeModal = function() {
    const modal = document.getElementById('anime-modal');
    if(modal) modal.style.display = 'none';
    _editingAnimeId = null;
}

window.setAnimeRating = function(val) {
    _animeRating = val;
    const container = document.querySelector('#anime-modal .star-rating');
    if(!container) return;
    
    const stars = container.querySelectorAll('i');
    stars.forEach(s => {
        const v = parseInt(s.getAttribute('data-val'));
        s.classList.remove('fas', 'far', 'active');
        if(v <= val) {
            s.classList.add('fas', 'active');
            s.style.color = '#ffca28';
        } else {
            s.classList.add('far');
            s.style.color = '#ccc';
        }
    });
}

document.getElementById('file-anime-thumb').onchange = (e) => {
    if(e.target.files[0]){
        const r = new FileReader();
        r.onload = ev => {
            _animeTempImage = ev.target.result;
            const img = document.getElementById('anime-preview');
            const txt = document.getElementById('anime-upload-text');
            if(img) { img.src = _animeTempImage; img.style.display = 'block'; }
            if(txt) txt.style.display = 'none';
        };
        r.readAsDataURL(e.target.files[0]);
    }
};

window.populateAnimeSuggestions = function() {
    const list = document.getElementById('anime-suggestions');
    if (!list || typeof appData === 'undefined') return;
    list.innerHTML = '';
    const uniqueNames = [...new Set((appData.animeList || []).map(a => a.name))];
    uniqueNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        list.appendChild(opt);
    });
}

window.checkAnimeAutoFill = function() {
    if(_editingAnimeId) return;

    const nameInput = document.getElementById('anime-name');
    if (!nameInput || typeof appData === 'undefined') return;
    const val = nameInput.value.trim();
    if (!val) return;
    
    const existing = (appData.animeList || []).find(a => a.name.toLowerCase() === val.toLowerCase());
    
    if (existing) {
        const authInput = document.getElementById('anime-author');
        if(authInput && !authInput.value) authInput.value = existing.author;
        
        if (!_animeTempImage && existing.image) {
            _animeTempImage = existing.image; 
            const img = document.getElementById('anime-preview');
            const txt = document.getElementById('anime-upload-text');
            if(img) { 
                img.src = resolveAnimePath(existing.image); 
                img.style.display = 'block'; 
            }
            if(txt) txt.style.display = 'none';
        }
    }
}

// ================= SALVAR =================
window.confirmAnimeEntry = function() {
    if (typeof appData === 'undefined') return;

    const nameInput = document.getElementById('anime-name');
    const name = nameInput ? nameInput.value.trim() : "";
    if (!name) { alert("O nome é obrigatório!"); return; }
    
    const epInput = document.getElementById('anime-ep-title');
    const authInput = document.getElementById('anime-author');
    const revInput = document.getElementById('anime-review');

    let finalImage = _animeTempImage;
    if(typeof processImage === 'function' && _animeTempImage) {
        finalImage = processImage(_animeTempImage);
    }

    const entryData = {
        name: name,
        epTitle: epInput ? epInput.value.trim() : "",
        author: authInput ? authInput.value.trim() : "",
        rating: _animeRating,
        review: revInput ? revInput.value.trim() : "",
        image: finalImage || null,
        date: new Date().toISOString()
    };

    if (_editingAnimeId) {
        const index = appData.animeList.findIndex(a => a.id === _editingAnimeId);
        if(index !== -1) {
            appData.animeList[index] = { ...appData.animeList[index], ...entryData };
        }
    } else {
        entryData.id = Date.now();
        if(!appData.animeList) appData.animeList = [];
        appData.animeList.unshift(entryData);
    }
    
    if(typeof saveData === 'function') saveData();
    if(typeof performAutoSave === 'function') performAutoSave();
    
    renderAnimeList();
    closeAnimeModal();
}

// ================= DELETAR EPISÓDIO =================
window.deleteAnimeEntry = function(event, id) {
    if (event) event.stopPropagation();

    const numericId = Number(id);
    const performDelete = () => {
        if(typeof appData !== 'undefined' && appData.animeList) {
            appData.animeList = appData.animeList.filter(a => a.id !== numericId);
            
            if(typeof saveData === 'function') saveData();
            if(typeof performAutoSave === 'function') performAutoSave();
            
            renderAnimeList(); 
        }
        const modal = document.getElementById('confirm-modal');
        if(modal) modal.style.display = 'none';
    };

    const modal = document.getElementById('confirm-modal');
    const btnYes = document.getElementById('btn-confirm-action');
    const msg = document.getElementById('confirm-msg');

    if (modal && btnYes) {
        if(msg) msg.innerText = "Tem certeza que deseja apagar este episódio?";
        const newBtn = btnYes.cloneNode(true);
        btnYes.parentNode.replaceChild(newBtn, btnYes);
        newBtn.onclick = performDelete;
        modal.style.display = 'flex';
    } else {
        if(confirm("Apagar?")) performDelete();
    }
}