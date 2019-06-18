#!/usr/bin/env node

const fs = require('fs');
const assert = require('@brillout/reassert');
const path_module = require('path');
const find_up = require('find-up');
const findPackageFiles = require('@brillout/find-package-files');
const escapeRegexp = require('lodash.escaperegexp');

if( is_cli() ) {
    const cliArg = process.argv[2];
    const dir_path = (
        cliArg && !cliArg.startsWith('-') ? (
            path_module.resolve(process.cwd(), cliArg)
        ) : (
            undefined
        )
    );
    mdocs(dir_path);
} else {
    module.exports = mdocs;
}

function is_cli() {
    return require.main === module;
}

function mdocs(dir_path=process.cwd()) {
    assert.usage(dir_path.startsWith('/'), dir_path);

    const TEMPLATE_EXT = '.template.md';

    (() => {
        const package_info = get_package_info(dir_path);
        const monorepo_package_info = get_monorepo_pacakge_info();
        assert.usage(package_info || monorepo_package_info);

        const git_info = get_git_info();
        const repo_base = get_repo_base({package_info, monorepo_package_info});

        const templates = find_templates({repo_base});

        assert.usage(
            templates.length>0,
            "Can't find any `"+path_module.resolve(dir_path, "*.template.md")+"` file."
        );

        templates
        .forEach(template => {
            add_menu(template, templates);
            apply_variables(template);
            add_inline_code({template, monorepo_package_info, git_info, repo_base});
         // replace_package_paths(template);
            add_edit_note(template);
            write_content(template);
        });
    })();

    return;

    function get_package_info(dir_path) {
        const package_json_path = find_up.sync('package.json', {cwd: dir_path});
        assert.internal(package_json_path, dir_path);
        const pkg_info = require(package_json_path);
        const absolute_path = path_module.dirname(package_json_path);
        pkg_info.absolute_path = absolute_path;
        return pkg_info;
    }
    function get_monorepo_pacakge_info(cwd=dir_path) {
        const package_json_path = find_up.sync('package.json', {cwd});
        if( ! package_json_path ) {
            return null;
        }
        const pkg_info = require(package_json_path);
        if( ! pkg_info.workspaces ) {
            return get_monorepo_pacakge_info(path_module.dirname(path_module.dirname(package_json_path)));
        }
        const absolute_path = path_module.dirname(package_json_path);
        pkg_info.absolute_path = absolute_path;
        return pkg_info;
    }

    function get_git_info() {
        const git_root_path = find_up.sync('.git', {cwd: dir_path});
        const absolute_path = path_module.dirname(git_root_path);
        return {absolute_path};
    }

    function add_menu(template, templates) {
        const menu_token = '!MENU';
        const lines = template.content.split('\n');
        const menu_line = lines.filter(is_menu_line);
        assert(menu_line.length<=1);
        if( menu_line.length===0 ) {
            return;
        }

        const menu_text = get_menu_text(template, templates);

        template.content = (
            lines
            .map(line => {
                if( ! is_menu_line(line) ) {
                    return line;
                }
                return menu_text;
            })
            .join('\n')
        )
        function is_menu_line(line) {
            const is_hit = line===menu_token;
            assert(is_hit || line.indexOf(menu_token)===-1);
            return is_hit;
        }
    }

    function get_menu_text(template, templates) {
        const templates_ordered = (
            templates
            .slice()
            .sort((t1, t2) => parseInt(t1.menu_order||0) - parseInt(t2.menu_order||0))
        );

        let menu_lines = [];
        templates_ordered
        .forEach((template__current, i) => {
            if( template__current.menu_skip ) {
                return;
            }
            const link_url = template__current.menu_link || template__current.dist_path__md_relative;
            let link_title = template__current.menu_title;

            if( template__current === template ) {
                link_title = "<b>"+link_title+"</b>";
            }
            const link = '<a href="'+link_url+'#readme">'+link_title+'</a>';
            /*
            if( template__current === template ) {
                link_title = "**"+link_title+"**";
            }
            const link = '['+link_title+']('+link_url+')';
            */

            const {menu_section} = template__current;

            if( ! menu_section ) {
                menu_lines.push(link);
            } else {
                const template__prev = templates_ordered[i-1]||{};
                const is_first = template__prev.menu_section !== menu_section;
                if( is_first ) {
                    menu_lines.push(menu_section);
                }
                const last_line_idx = menu_lines.length-1;
                const last_line = menu_lines[last_line_idx];
                const separator = is_first && menu_section && ': ' || !is_first && ' | ' || '';
                menu_lines[last_line_idx] = last_line+separator+link;
            }
        });

        if( true ) {
            let menu_text = "";
            menu_text += "<p align='center'>";
            menu_lines.map((line, i) => {
                const isLastLine = i===menu_lines.length-1;
                menu_text += line;
                if( ! isLastLine ) {
                    menu_text += " &nbsp; | &nbsp; ";
                }
            });
            menu_text += "</p>";
            return menu_text;
        }

        /*
        const {menu_indent} = template;
        if( menu_indent ) {
            menu_lines = menu_lines.map(line => {
                for(let i=0; i < menu_indent; i++) {
                    line = '&nbsp; '+line;
                }
                return line;
            });
        }

        const menu_text = menu_lines.join('<br/>\n');

        return menu_text;
        */

    }

    function apply_variables(template) {
      const vars = getVars();
      template.content = applyVars();

      return;

      function getVars() {
        const vars = {};
        let lines = template.content.split('\n');
        lines = lines.filter(line => {
          if( !line.startsWith('!VAR ') ){
            return true;
          }
          const [varName,...varValue] = line.split(' ').slice(1);
          vars[varName] = varValue.join(' ');
          return false;
        });
        template.content = lines.join('\n');
        return vars;
      }

      function applyVars() {
        let newContent = template.content;
        Object.entries(vars)
        .forEach(([varName, varValue]) => {
          newContent = newContent.replace(new RegExp(escapeRegexp('!VAR '+varName)+'\\b', 'g'), varValue);
          newContent = newContent.replace(new RegExp(escapeRegexp('!VAR|LINK '+varName)+'\\b', 'g'), '<a href=#'+GithubId(varValue)+'>'+varValue+'</a>');
          newContent = newContent.replace(new RegExp(escapeRegexp('!VAR|ANCHOR '+varName)+'\\b', 'g'), '#'+GithubId(varValue));
        });
        return newContent;
      }
    }
    function add_inline_code({template, monorepo_package_info, git_info, repo_base}) {
        template.content = apply_inline({
            content: template.content,
            context_path: template.template_path,
            package_info: template.package_info,
            monorepo_package_info,
            git_info,
            repo_base,
        });
    }

    function apply_inline({content, context_path, package_info, monorepo_package_info, git_info, repo_base}) {
        let content__new = '';

        const lines = content.split('\n');

        lines.forEach((line, i) => {
            const inline_token = '!INLINE';

            if( ! line.startsWith(inline_token+' ') ) {
                content__new += line;
                if( i !== lines.length-1 ) {
                    content__new += '\n';
                }
                return;
            }

            const {inputs, opts} = parseCommandLine(line);

            const file_path__spec = inputs[0];
            assert.usage(file_path__spec, line);

            const file_path = getFilePath({file_path__spec, git_info, context_path, repo_base});

            let file_content = getFileContent(file_path);

            file_content = file_content.replace(/\n+$/,'');

            inputs.forEach((arg, i) => {
                const argRegexp = new RegExp(escapeRegexp('!ARGUMENT-'+i), 'g');
                file_content = file_content.replace(argRegexp, arg)
            });
            file_content = (
              file_content
              .replace(
                new RegExp(escapeRegexp('!ARGUMENTS'), 'g'),
                inputs.slice(1).join(' ')
              )
            );

            let hide_source_path = (() => {
              const macroString = '!HIDE-SOURCE-PATH';
              const file_lines = file_content.split('\n');

              file_content = file_lines.filter(line => line!==macroString).join('\n');

              return file_lines.includes(macroString);
            })();

            file_content = apply_inline({
                content: file_content,
                context_path: file_path,
                package_info,
                monorepo_package_info,
            });

            file_content = (
              resolve_package_path(file_path, file_content, package_info) + '\n'
            );

            hide_source_path = hide_source_path || !!opts['--hide-source-path'];
            if( ! hide_source_path ) {
                /*
                const repo_base = get_repo_base({package_info, monorepo_package_info});
                const code_path = path_module.relative(repo_base, file_path);
                content__new += '// /'+code_path+'\n\n';
                */
                content__new += '// '+file_path__spec+'\n\n';
            }

            content__new += file_content;
        });

        return content__new;
    }

    function get_repo_base({package_info, monorepo_package_info}) {
      const repo_base = (monorepo_package_info||{}).absolute_path || (package_info||{}).absolute_path;
      assert.internal(repo_base);
      return repo_base;
    }

    function parseCommandLine(line) {
        const words = line.split(' ');
        const command = words.shift();
        const opts = {};
        const inputs = [];
        words.forEach(word => {
            if( word.startsWith('--') ) {
                opts[word] = true;
            } else {
                inputs.push(word);
            }
        });

     // for(let i=0;i<10;i++) inputs.push('');

        return {command, inputs, opts};
    }

    function resolve_package_path(file_path, file_content, package_info) {
        if( package_info.private ) {
            return file_content;
        }

        const rel_path = path_module.relative(path_module.dirname(file_path), package_info.absolute_path) || '.';
        assert.internal(rel_path);

     // console.log(file_path, package_info.absolute_path, rel_path);

        const regex_require = new RegExp("require\\('"+escapeRegexp(rel_path)+"'\\)", 'g');
        file_content = file_content.replace(regex_require, "require('"+package_info.name+"')");

        const regex_import = new RegExp(" from '"+escapeRegexp(rel_path)+"'", 'g');
        file_content = file_content.replace(regex_import, " from '"+package_info.name+"'");

        return file_content;
    }

    function add_edit_note(template) {
        const EDIT_NOTE = gen_edit_note(template.template_path__md_relative);

        template.content = [
            EDIT_NOTE,
            template.content,
            EDIT_NOTE,
            '',
        ].join('\n');
    }

    /*
    function replace_package_paths(template) {
        [
         // 'reprop',
         // 'react-reprop',
            {
                path_end: 'stores/Items',
                replace_with: '../stores/Items',
            },
        ].forEach(node_module => {
            const {path_end, replace_with} = (
                node_module.path_end ? (
                    node_module
                ) : (
                    {path_end: node_module, replace_with: node_module}
                )
            );
            const regex_require = new RegExp("require\\('.*\\/"+path_end+"'\\)", 'g');
            template.content = template.content.replace(regex_require, "require('"+replace_with+"')");

            const regex_import = new RegExp(" from '.*\\/"+path_end+"'", 'g');
            template.content = template.content.replace(regex_import, " from '"+replace_with+"'");
        });

        return template.content;
    }
    */

    function write_content(template) {
        fs.writeFileSync(
            template.dist_path,
            template.content,
        );
    }

    function getFilePath({file_path__spec, git_info, context_path, repo_base}) {
      assert.internal(file_path__spec.constructor===String);

      if( !file_path__spec.includes('.') ){
        file_path__spec += ".md";
      }

      const base_dir = path_module.dirname(context_path);
      let file_path;
      if( !file_path__spec.includes('/') ){
        const found = (
          findPackageFiles(
            '*'+file_path__spec,
            {cwd: repo_base},
          )
        );
        assert.usage(found.length===1, {found, file_path__spec});
        file_path = found[0];
      } else {
        if( file_path__spec.startsWith('/') ){
          file_path = (
            path_module.join(
              git_info.absolute_path,
              file_path__spec,
            )
          );
        } else {
          file_path = (
            path_module.resolve(
              base_dir,
              file_path__spec,
            )
          );
        }
      }

      try {
        file_path = require.resolve(file_path);
      } catch(err) {
        console.error(err);
        assert.usage(
          false,
          "Can't find `"+file_path__spec+"`.",
          "Resolved to `"+file_path+"` from `"+base_dir+"`",
        );
      }

      assert.internal(path_module.isAbsolute(file_path));
      return file_path;
    }

    function getFileContent(path) {
        return fs.readFileSync(require.resolve(path)).toString();
    }

    function flatten(arr, el) {
        return [...arr, ...el];
    }

    function gen_edit_note(src_path) {
        const padding = new Array(5).fill('\n').join('');
        return (
            [
                '<!---',
                ...(
                    new Array(5)
                    .fill([
                        padding,
                        '    WARNING, READ THIS.',
                        '    This is a computed file. Do not edit.',
                        '    Edit `'+src_path+'` instead.',
                        padding,
                    ].join('\n'))
                ),
                '-->',
            ]
            .join('\n')
        );
    }

    function find_templates({repo_base}) {
        return (
            findPackageFiles('*'+TEMPLATE_EXT, {cwd: repo_base})
            .map(template_path => {
                assert.internal(template_path.endsWith(TEMPLATE_EXT));

                const package_info = get_package_info(path_module.dirname(template_path));

                let content = getFileContent(template_path);

                const output_filename = get_token_argument('OUTPUT');

                const dist_path = distify(template_path);
                const dist_path__md_relative = make_relative_to_repo_base(dist_path);
                const template_path__md_relative = make_relative_to_repo_base(template_path);
                const filename_base = path_module.basename(template_path).split('.')[0];

                const menu_indent = get_token_argument('MENU_INDENT');
                const menu_order = get_token_argument('MENU_ORDER');
                const menu_link = get_token_argument('MENU_LINK');
                const menu_skip = get_token_argument('MENU_SKIP');
                const menu_section = get_token_argument('MENU_SECTION');

                let menu_title = get_token_argument('MENU_TITLE');
                if( menu_title === null ) {
                    menu_title = titlize(filename_base);
                }

                return {
                    template_path,
                    package_info,
                    content,
                    dist_path,
                    dist_path__md_relative,
                    template_path__md_relative,
                    filename_base,
                    menu_order,
                    menu_link,
                    menu_title,
                    menu_skip,
                    menu_indent,
                    menu_section,
                    output_filename,
                };

                function distify(path) {
                    if( ! output_filename ) {
                        const path_without_template_suffix = path.slice(0, -TEMPLATE_EXT.length)+'.md';
                        return path_without_template_suffix;
                    } else {
                        const source_dir = path_module.dirname(path);
                        return path_module.resolve(source_dir, output_filename);
                    }
                }

                function make_relative_to_repo_base(file_path) {
                    const file_path__relative = path_module.relative(repo_base, file_path);
                    assert.internal(!file_path__relative.startsWith('.'), repo_base, file_path__relative, file_path);
                    const file_path__md_relative = (
                        file_path__relative
                        .split(path_module.sep)
                        .join('/')
                    );
                    return '/'+file_path__md_relative;
                }

                function get_token_argument(token) {
                    const {token_arg, content: content_new} = parse_content_for_info(token, content);
                    content = content_new;
                    return token_arg;
                }
            })
        );
    }

    function parse_content_for_info(token, content) {
        const prefix = '!'+token;
        const lines = content.split('\n');
        const token_line = lines.filter(is_token_line);
        assert(token_line.length<=1);

        content = (
            lines
            .filter(line => !is_token_line(line))
            .join('\n')
        );

        const token_arg = (
            token_line.length===0 ? (
                null
            ) : (
                token_line[0].slice(prefix.length+1) || true
            )
        );

        return {token_arg, content};

        function is_token_line(line) {
            const is_hit = line.startsWith(prefix);
            assert(is_hit || line.indexOf(prefix)===-1);
            return is_hit;
        }
    }
}

function titlize(filename_base){
    return (
        filename_base
        .split('-')
        .map(word =>
            word.length <= 3 ? (
                word
            ) : (
                word[0].toUpperCase() + word.slice(1)
            )
        )
        .join(' ')
    );
}

function GithubId(val) {
	return val.toLowerCase().replace(/ /g,'-')
		// single chars that are removed
		.replace(/[`~!@#$%^&*()+=<>?,./:;"'|{}\[\]\\–—]/g, '')
		// CJK punctuations that are removed
		.replace(/[　。？！，、；：“”【】（）〔〕［］﹃﹄“”‘’﹁﹂—…－～《》〈〉「」]/g, '')
}
