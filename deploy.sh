#!/bin/bash
echo "=== Antigravity Cycling - GitHub 部署助手 ==="

# 檢查是否有安裝 git
if ! command -v git &> /dev/null
then
    echo "❌ 錯誤：本機未偵測到 git，請先安裝 git！"
    exit 1
fi

# 如果尚未初始化 git，則進行初始化
if [ ! -d ".git" ]; then
    git init
    echo "Initialized empty Git repository."
fi

# 新增所有檔案並進行第一次提交
git add .
git commit -m "Initialize cycling app with multi-user, history, rules engine, and iOS support" 2>/dev/null || echo "檔案無異動，跳過提交。"
git branch -M main

echo ""
echo "請輸入您的 GitHub 儲存庫網址 (HTTPS)"
echo "（例：https://github.com/您的帳號/cycling-app.git）："
read -p "網址: " repo_url

if [ -z "$repo_url" ]; then
    echo "❌ 錯誤：未輸入儲存庫網址，部署終止。"
    exit 1
fi

# 移除已有的 origin 避免重複錯誤，並重新加入
git remote remove origin 2>/dev/null
git remote add origin "$repo_url"

echo ""
echo "正在將代碼推送到 GitHub 'main' 分支..."
echo "提示：若需要驗證，請輸入您的 GitHub 帳號與 Personal Access Token (個人訪問密鑰)。"
echo ""

git push -u origin main

if [ $? -eq 0 ]; then
    # 擷取帳號與儲存庫名稱用作引導
    # 預期格式: https://github.com/username/repo.git
    clean_url=$(echo "$repo_url" | sed 's/\.git$//')
    username=$(echo "$clean_url" | cut -d'/' -f4)
    repo_name=$(echo "$clean_url" | cut -d'/' -f5)
    
    pages_url="https://$username.github.io/$repo_name/"
    settings_url="https://github.com/$username/$repo_name/settings/pages"
    
    echo ""
    echo "=== 🎉 部署指令完成！ ==="
    echo "接下來請依照以下步驟啟用網頁："
    echo "1️⃣  前往您的 GitHub 設定頁面："
    echo "    $settings_url"
    echo "2️⃣  在 'Build and deployment' 區塊下，將 Source 設定為 'Deploy from a branch'。"
    echo "3️⃣  將 Branch 選取為 'main'，資料夾維持 '/ (root)'，點擊 [Save] 儲存。"
    echo "4️⃣  稍等 1-2 分鐘，您即可用 iPhone 的 Bluefy 瀏覽器開啟專屬運動網址："
    echo "    👉 $pages_url"
    echo "5️⃣  在 iPhone 上將該網址【加入書籤】或【加入主畫面】，即可在飛輪上隨時配對運動！"
else
    echo "❌ 錯誤：推送到 GitHub 失敗。請確認您已在 GitHub 網站上建立了該儲存庫，且輸入的網址與權限正確。"
fi
