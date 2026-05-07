import cluster from 'cluster';
import { cpus } from 'os';

const numCPUs = cpus().length;

if (cluster.isPrimary) {
  console.log(`[cluster] Master ${process.pid} starting ${numCPUs} workers`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
    console.log(`[cluster] Worker ${worker.process.pid} died (${signal || code}), restarting`);
    cluster.fork();
  });
} else {
  require('./main');
}
