const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Caminho onde vamos salvar as configurações da janela (tamanho e posição)
const statePath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (e) {
        return { width: 480, height: 800, isMaximized: false };
    }
}

function saveWindowState(win) {
    if (!win) return;
    try {
        const isMaximized = win.isMaximized();
        const bounds = isMaximized ? { width: 480, height: 800 } : win.getBounds();
        const state = { ...bounds, isMaximized: isMaximized };
        fs.writeFileSync(statePath, JSON.stringify(state));
    } catch (e) {
        console.error("Erro ao salvar estado:", e);
    }
}

function createWindow() {
    const state = loadWindowState();

    const win = new BrowserWindow({
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
        // MUDANÇA REALIZADA: Aponta para o arquivo .png (Melhor qualidade na janela/barra de tarefas)
        icon: path.join(__dirname, 'icon.png'), 
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        autoHideMenuBar: true,
        resizable: true,
        backgroundColor: '#05070a', // Fundo escuro para não piscar branco ao abrir
        show: false 
    });

    if (state.isMaximized) {
        win.maximize();
    }

    win.loadFile('index.html');

    // Só mostra a janela quando ela estiver pronta (evita tela branca piscando)
    win.once('ready-to-show', () => {
        win.show();
    });

    // Salva o estado ao fechar
    win.on('close', () => {
        saveWindowState(win);
    });

    // Listener para Tela Cheia
    ipcMain.on('toggle-fullscreen', () => {
        const isFullScreen = win.isFullScreen();
        win.setFullScreen(!isFullScreen);
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});