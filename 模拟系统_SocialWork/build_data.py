import os
import re
import json
import shutil

def process_md_content(text, md_dir, images_target_dir):
    if not text:
        return ""
        
    # 1. Handle images: ![alt](path) -> <img src="data/images/name" class="q-img">
    # Use re.sub with a pattern that might include surrounding newlines to strip them
    img_pattern = r'\n*!\[.*?\]\((.*?)\)\n*'
    
    def img_replacer(match):
        img_path = match.group(1)
        src_img_path = os.path.normpath(os.path.join(md_dir, img_path))
        if os.path.exists(src_img_path):
            img_filename = os.path.basename(src_img_path)
            dest_img_path = os.path.join(images_target_dir, img_filename)
            shutil.copy2(src_img_path, dest_img_path)
            # Use data/images/ relative path for the web
            return f'<img src="data/images/{img_filename}" class="q-img">'
        return match.group(0)

    text = re.sub(img_pattern, img_replacer, text)
            
    # 2. Handle bold: **text** -> <strong>text</strong>
    text = re.sub(r'\*\*([\s\S]*?)\*\*', r'<strong>\1</strong>', text)
    
    return text.strip()

def parse_md_file(file_path, chapter_name, images_target_dir):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    md_dir = os.path.dirname(file_path)
    questions_raw = re.split(r'## 第 \d+ 题', content)
    parsed_questions = []
    
    question_id_counter = 1
    
    for q_block in questions_raw:
        if not q_block.strip() or '[' not in q_block:
            continue
            
        try:
            # Extract type
            type_match = re.search(r'\[(.*?)\]', q_block)
            q_type = type_match.group(1) if type_match else "单选题"
            
            # Extract question text
            q_text_match = re.search(r'\*\*题目：\*\*(.*?)\*\*选项：\*\*', q_block, re.DOTALL)
            if not q_text_match: continue
            q_text = q_text_match.group(1).strip()
            q_text = re.sub(r'^\d+\.\s*', '', q_text)
            q_text = process_md_content(q_text, md_dir, images_target_dir)

            # Extract options
            options_block_match = re.search(r'```(.*?)```', q_block, re.DOTALL)
            options = []
            if options_block_match:
                options_raw = options_block_match.group(1).strip().split('\n')
                for opt in options_raw:
                    opt = opt.strip()
                    if not opt: continue
                    
                    key = ""
                    text = ""
                    if '.' in opt:
                        key, text = opt.split('.', 1)
                    elif ':' in opt:
                        key, text = opt.split(':', 1)
                    
                    if key:
                        options.append({
                            "key": key.strip(), 
                            "text": process_md_content(text.strip(), md_dir, images_target_dir)
                        })

            # Extract answer
            answer_match = re.search(r'> \*\*正确答案：\*\*\s*([A-Z]+)', q_block)
            answer = answer_match.group(1) if answer_match else ""
            
            # Extract explanation (Stop at horizontal rule ---)
            explanation_match = re.search(r'\*\*解析：\*\*(.*?)(?:\n\s*---\s*\n|$)', q_block, re.DOTALL)
            explanation = explanation_match.group(1).strip() if explanation_match else ""
            explanation = process_md_content(explanation, md_dir, images_target_dir)
            
            parsed_questions.append({
                "id": question_id_counter, 
                "type": q_type,
                "question": q_text,
                "options": options,
                "answer": answer,
                "explanation": explanation,
                "chapter": chapter_name
            })
            question_id_counter += 1
        except Exception as e:
            print(f"Error parsing a question in {file_path}: {e}")
            
    return parsed_questions

def build():
    base_dir = "source_data"
    chapter_dir = os.path.join(base_dir, "章节练习")
    images_target_dir = os.path.join("data", "images")
    
    if not os.path.exists(images_target_dir):
        os.makedirs(images_target_dir)

    all_questions = []
    
    if os.path.exists(chapter_dir):
        chapters = sorted([d for d in os.listdir(chapter_dir) if os.path.isdir(os.path.join(chapter_dir, d))])
        global_id = 1
        for chapter in chapters:
            chapter_path = os.path.join(chapter_dir, chapter)
            md_files = sorted([f for f in os.listdir(chapter_path) if f.endswith('.md')])
            for md_file in md_files:
                qs = parse_md_file(os.path.join(chapter_path, md_file), chapter, images_target_dir)
                for q in qs:
                    q['id'] = global_id
                    global_id += 1
                    all_questions.append(q)
    
    # Write to js/questions.js
    output_path = os.path.join("js", "questions.js")
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("const questionsData = " + json.dumps(all_questions, ensure_ascii=False, indent=2) + ";")
    
    print(f"Successfully built {len(all_questions)} questions into {output_path}")

if __name__ == "__main__":
    build()
