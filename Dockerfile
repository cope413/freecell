FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css manifest.webmanifest sw.js /usr/share/nginx/html/
COPY src /usr/share/nginx/html/src
COPY icons /usr/share/nginx/html/icons
EXPOSE 80
