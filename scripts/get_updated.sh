#!/bin/bash
git pull | grep -v 'up to date' && docker-compose down && docker-compose up -d --build 
