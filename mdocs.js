#!/usr/bin/env node

const fs = require('fs');
const assert = require('reassert');
const assert_usage = assert;
const assert_internal = assert;
const path_module = require('path');
const find_up = require('find-up');
const findPackageFiles = require('@brillout/find-package-files');

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
    assert_usage(dir_path.startsWith('/'), dir_path);

    const TEMPLATE_EXT = '.template.md';

    (() => {
        const package_info = get_package_info();
        const monorepo_package_info = get_monorepo_pacakge_info();
        assert_usage(package_info || monorepo_package_info);

        const git_info = get_git_info();

        const templates = find_templates(git_info);

        assert_usage(
            templates.length>0,
            "Can't find any `"+path_module.resolve(dir_path, "*.template.md")+"` file."
        );

        templates
        .forEach(template => {
            add_menu(template, templates);
            add_inline_code(template, package_info, monorepo_package_info);
         // replace_package_paths(template);
            add_edit_note(template);
            write_content(template);
        });
    })();

    return;

    function get_package_info() {
        const package_json_path = find_up.sync('package.json', {cwd: dir_path});
        assert_internal(package_json_path, dir_path);
        const package_info = require(package_json_path);
        if( package_info.private || package_info.workspaces ) {
            return null;
        }
        const absolute_path = path_module.dirname(package_json_path);
        package_info.absolute_path = absolute_path;
        return package_info;
    }
    function get_monorepo_pacakge_info(cwd=dir_path) {
        const package_json_path = find_up.sync('package.json', {cwd});
        if( ! package_json_path ) {
            return null;
        }
        const package_info = require(package_json_path);
        if( ! package_info.workspaces ) {
            return get_monorepo_pacakge_info(path_module.dirname(path_module.dirname(package_json_path)));
        }
        const absolute_path = path_module.dirname(package_json_path);
        package_info.absolute_path = absolute_path;
        return package_info;
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
                link_title = "**"+link_title+"**";
            }
            const link = '['+link_title+']('+link_url+')';

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

    }

    function add_inline_code(template, package_info, monorepo_package_info) {
        template.content = apply_inline({
            content: template.content,
            context_path: template.template_path,
            package_info,
            monorepo_package_info,
        });
    }

    function apply_inline({content, context_path, package_info, monorepo_package_info}) {
        let content__new = '';

        const lines = content.split('\n');

        lines.forEach((line, i) => {
            const inline_token = '!INLINE';

            if( ! line.includes(' '+inline_token+' ') && ! line.startsWith(inline_token+' ') ) {
                content__new += line;
                if( i !== lines.length-1 ) {
                    content__new += '\n';
                }
                return;
            }

            const words = line.split(' ');
            const prefix_idx = words.findIndex(word => word===inline_token);
            assert_internal(prefix_idx>=0);
            const argv = words.slice(prefix_idx+1);
            assert_usage(argv.length>0);

            const file_path__relative = argv[0];

            const file_path = (
                path_module.resolve(
                    path_module.dirname(context_path),
                    file_path__relative,
                )
            );

            let file_content = getFileContent(file_path);
            file_content = file_content.replace(/\n+$/,'');
            argv.forEach((arg, i) => file_content = file_content.replace('!ARGUMENT-'+i, arg));
            file_content = apply_inline({
                content: file_content,
                context_path: file_path,
                package_info,
                monorepo_package_info,
            });

            let new_content;
            if( ! line.startsWith(inline_token) ) {
                new_content = line.split(inline_token)[0] + file_content;
            }
            else {
                const code_include_path = ! argv.includes('--hide-source-path');
                const repo_base = (monorepo_package_info||{}).absolute_path || (package_info||{}).absolute_path;
                assert_internal(repo_base);
                const code_path = path_module.relative(repo_base, file_path);
                if( code_include_path ) {
                    content__new += (
                        [
                            '// /'+code_path,
                            '',
                            '',
                        ].join('\n')
                    );
                }

                new_content = resolve_package_path(file_path, file_content, package_info);
            }

            content__new += new_content + '\n';
        });

        return content__new;
    }

    function resolve_package_path(file_path, file_content, package_info) {
        if( package_info===null ) {
            return file_content;
        }

        const rel_path = path_module.relative(path_module.dirname(file_path), package_info.absolute_path) || '.';
        assert_internal(rel_path);

     // console.log(file_path, package_info.absolute_path, rel_path);

        const regex_require = new RegExp("require\\('"+rel_path+"'\\)", 'g');
        file_content = file_content.replace(regex_require, "require('"+package_info.name+"')");

        const regex_import = new RegExp(" from '"+rel_path+"'", 'g');
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

    function getFileContent(path) {
        return fs.readFileSync(path).toString();
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

    function find_templates(git_info) {
        return (
            findPackageFiles('*'+TEMPLATE_EXT, {cwd: dir_path})
            .map(template_path => {
                assert_internal(template_path.endsWith(TEMPLATE_EXT));
                let content = getFileContent(template_path);

                const output_filename = get_token_argument('OUTPUT');

                const dist_path = distify(template_path);
                const dist_path__md_relative = make_relative_to_package_root(dist_path);
                const template_path__md_relative = make_relative_to_package_root(template_path);
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

                function make_relative_to_package_root(file_path) {
                    const file_path__relative = path_module.relative(git_info.absolute_path, file_path);
                    assert_internal(!file_path__relative.startsWith('.'), git_info.absolute_path, file_path__relative, file_path);
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
