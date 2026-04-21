# Step 1
git pull
# Step 2
pelican -s pelicanconf.py -o output -t atilla
# Step 3
ghp-import -m "Generate Pelican site" -b gh-pages output
# Step 4
git push origin gh-pages
# Step 5
# Change to www.brandonanhorn.com on pages portion of github
