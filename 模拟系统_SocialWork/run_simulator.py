import http.server
import socketserver
import os
import json
import build_data  # Reuse the parsing logic

PORT = 8000

class DynamicSimulatorHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Intercept request for questions.js
        if self.path == '/js/questions.js' or self.path.startswith('/js/questions.js?'):
            print("🚀 Detected page refresh, re-parsing MD files...")
            try:
                # 1. Clear images target dir to avoid stale data (optional)
                # 2. Run build process in-memory or regenerate file
                build_data.build() 
                
                # 3. Serve the freshly generated file
                return http.server.SimpleHTTPRequestHandler.do_GET(self)
            except Exception as e:
                print(f"❌ Error during dynamic parsing: {e}")
                self.send_error(500, f"Internal Server Error: {e}")
                return

        # Otherwise serve static files as usual
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

def run():
    # Set the working directory to the project root
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    Handler = DynamicSimulatorHandler
    
    # Allow port reuse to avoid "Address already in use" errors during quick restarts
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"\n" + "="*50)
        print(f"✅ 社会工作模拟练习系统 已启动！")
        print(f"🔗 访问地址: http://localhost:{PORT}")
        print(f"📝 实时同步已开启：修改 MD 文件后，只需刷新网页即可看到更新。")
        print(f"🛑 按 Ctrl+C 停止服务器")
        print("="*50 + "\n")
        httpd.serve_forever()

if __name__ == "__main__":
    run()
