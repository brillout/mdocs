#!/usr/bin/env node

const fs = require('fs');
const assert = require('reassert');
const assert_usage = assert;
const path_module = require('path');
const find_up = require('find-up');

if( is_cli() ) {
    mdocs();
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
        const templates = find_templates();

        const package_info = get_package_info();

        assert_usage(
            templates.length>0,
            "Can't find any `"+path_module.resolve(dir_path, "*.template.md")+"` file."
        );

        templates
        .forEach(template => {
            add_menu(template, templates);
            add_inline_code(template);
         // replace_package_paths(template);
            resolve_package_path(template, package_info);
            add_edit_note(template);
            write_content(template);
        });
    })();

    return;

    function get_package_info() {
        const package_json_path = find_up.sync('package.json', {cwd: dir_path});
        const package_json = require(package_json_path);
        package_json.absolute_path = path_module.dirname(package_json_path);
        return package_json;
    }

    function add_menu(template, templates) {
        const prefix = '!MENU';
        const lines = template.content.split('\n');
        const menu_line = lines.filter(is_menu_line);
        assert(menu_line.length<=1);
        if( menu_line.length===0 ) {
            return;
        }
        const menu_text = (
            templates
            .slice()
            .sort((t1, t2) => parseInt(t1.menu_order||0) - parseInt(t2.menu_order||0))
            .map(template => {
                const link = template.menu_link || template.dist_path__md_relative;
                return '['+template.menu_title+']('+link+')';
            })
            .join('<br/>\n')
        );
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
            const is_hit = line===prefix;
            assert(is_hit || line.indexOf(prefix)===-1);
            return is_hit;
        }
    }

    function add_inline_code(template) {

        let content = '';

        const lines = template.content.split('\n');

        lines.forEach((line, i) => {
            const prefix = '!INLINE';

            if( ! line.startsWith(prefix) ) {
                content += line;
                if( i !== lines.length-1 ) {
                    content += '\n';
                }
                return;
            }

            const argv = line.split(' ');
            assert_usage(argv[0]===prefix);

            const file_path = argv[1];

            const file_content = (
                getFileContent(
                    path_module.resolve(
                        path_module.dirname(template.template_path),
                        file_path,
                    )
                )
                .replace(/\n+$/,'')
            );

            const code_include_path = ! argv.includes('--hide-source-path');
            if( code_include_path ) {
                content += (
                    [
                        '// /'+path_module.relative('..', file_path),
                        '',
                        '',
                    ].join('\n')
                );
            }

            content += file_content + '\n';
        });

        template.content = content;
    }

    function add_edit_note(template) {
        const EDIT_NOTE = gen_edit_note(template.source_path__md_relative);

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

    function resolve_package_path(template, package_info) {
        const rel_path = path_module.relative(template.template_path, package_info.absolute_path);

        const regex_require = new RegExp("require\\('"+rel_path+"'\\)", 'g');
        template.content = template.content.replace(regex_require, "require('"+package_info.name+"')");

        const regex_import = new RegExp(" from '"+rel_path+"'", 'g');
        template.content = template.content.replace(regex_import, " from '"+package_info.name+"'");
    }

    function write_content(template) {
        fs.writeFileSync(
            template.dist_path_relative,
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

    function find_templates() {
        return (
            fs.readdirSync(dir_path)
            .filter(filename => filename.endsWith(TEMPLATE_EXT))
            .map(template_path_relative => {
                const template_path = path_module.join(dir_path, template_path_relative)
                if( !template_path.endsWith(TEMPLATE_EXT) ) {
                    throw new Error('Should end with '+TEMPLATE_EXT);
                }
                let content = getFileContent(template_path);

                const output = get_info('OUTPUT');

                const dist_path_relative = distify(template_path);
                const dist_path__md_relative = make_path_md_absolute(distify(template_path_relative));
                const source_path__md_relative = make_path_md_absolute(template_path_relative);
                const filename_base = path_module.basename(template_path).split('.')[0];

                const menu_order = get_info('MENU_ORDER');
                const menu_link = get_info('MENU_LINK');
                let menu_title = get_info('MENU_TITLE');
                if( menu_title === null ) {
                    menu_title = titlize(filename_base);
                }

                return {
                    template_path,
                    template_path_relative,
                    content,
                    dist_path_relative,
                    dist_path__md_relative,
                    source_path__md_relative,
                    filename_base,
                    menu_order,
                    menu_link,
                    menu_title,
                    output,
                };

                function distify(path) {
                    const path_without_template_suffix = path.slice(0, -TEMPLATE_EXT.length)+'.md';
                    if( ! output ) {
                        return path_without_template_suffix;
                    }
                    const source_dir = path_module.dirname(path);
                    const output_filename = output;
                    return path_module.resolve(source_dir, output_filename);
                 // const output_dir = output;
                 // const output_filename = path_module.basename(path_without_template_suffix);
                 // return path_module.resolve(source_dir, output_dir, output_filename);
                }

                function make_path_md_absolute(path_relative) {
                    return '/'+path_module.join('docs', path_relative);
                }

                function get_info(token) {
                    const {info, content: content_new} = parse_content_for_info(token, content);
                    content = content_new;
                    return info;
                }

            })
        );
    }

    function parse_content_for_info(token, content) {
        const prefix = '!'+token+' ';
        const lines = content.split('\n');
        const token_line = lines.filter(is_token_line);
        assert(token_line.length<=1);

        content = (
            lines
            .filter(line => !is_token_line(line))
            .join('\n')
        );

        const info = (
            token_line.length===0 ? (
                null
            ) : (
                token_line[0].slice(prefix.length)
            )
        );

        return {info, content};

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
