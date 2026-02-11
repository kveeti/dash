FROM scratch
COPY ./back/backend /usr/local/bin/backend
COPY ./front/dist /app/frontend
ENV FRONTEND_DIR=/app/frontend
EXPOSE 8000
ENTRYPOINT ["backend"]
