package Thruk;

=head1 NAME

Thruk - Catalyst based monitoring web interface

=head1 DESCRIPTION

Catalyst based monitoring web interface for Nagios, Icinga and Shinken

=cut

use 5.008000;
use strict;
use warnings;
use utf8;

###################################################
# create connection pool
# has to be done before the binmode
# or even earlier to save memory
use Thruk::Backend::Pool;
BEGIN {
    Thruk::Backend::Pool::init_backend_thread_pool();
};

###################################################
# clean up env
use Thruk::Utils::INC;
BEGIN {
    Thruk::Utils::INC::clean();
}

use Carp;
use Moose;
use GD;
use POSIX qw(tzset);
use Log::Log4perl::Catalyst;
use Digest::MD5 qw(md5_hex);
use File::Slurp qw(read_file);
use Data::Dumper;
use MRO::Compat;
use Thruk::Utils;
use Thruk::Config;
use Thruk::Utils::Auth;
use Thruk::Utils::Filter;
use Thruk::Utils::Menu;
use Thruk::Utils::Avail;
use Thruk::Utils::External;
use Thruk::Utils::Cache qw/cache/;
use Catalyst::Runtime '5.70';

###################################################
# Set flags and add plugins for the application
#
#         -Debug: activates the debug mode for very useful log messages
#         StackTrace
BEGIN {
    my @catalyst_plugins = qw/
          Thruk::ConfigLoader
          Unicode::Encoding
          Compress
          Authentication
          Authorization::ThrukRoles
          CustomErrorMessage
          Static::Simple
          Redirect
          Thruk::RemoveNastyCharsFromHttpParam
    /;
    if($Catalyst::Runtime::VERSION >= 5.90042) {
        # since 5.90042 catalyst encodes by core
        @catalyst_plugins = grep(!/^Unicode::Encoding$/mx, @catalyst_plugins);
    }
    # fcgid setups have no static content
    if(defined $ENV{'THRUK_SRC'} and $ENV{'THRUK_SRC'} eq 'FastCGI') {
        @catalyst_plugins = grep(!/^Static::Simple$/mx, @catalyst_plugins);
    }
    require Catalyst;
    Catalyst->import(@catalyst_plugins);
    __PACKAGE__->config( encoding => 'UTF-8' );
};

###################################################
our $VERSION = '1.80';

###################################################
# load config loader
__PACKAGE__->config(%Thruk::Config::config);
__PACKAGE__->config( encoding => 'UTF-8' );

###################################################
# install leak checker
if($ENV{THRUK_LEAK_CHECK}) {
    eval {
        with 'CatalystX::LeakChecker';
        $Devel::Cycle::already_warned{'GLOB'} = 1;
    };
    print STDERR "failed to load CatalystX::LeakChecker: ".$@ if $@;
}

###################################################
# Start the application and make __PACKAGE__->config
# accessible
# override config in Catalyst::Plugin::Thruk::ConfigLoader
__PACKAGE__->setup();
$Thruk::Utils::IO::config = __PACKAGE__->config;

###################################################
binmode(STDOUT, ":encoding(UTF-8)");
binmode(STDERR, ":encoding(UTF-8)");
$Data::Dumper::Sortkeys = 1;

###################################################
# init cache
Thruk::Utils::IO::mkdir(__PACKAGE__->config->{'tmp_path'});
__PACKAGE__->cache(__PACKAGE__->config->{'tmp_path'}.'/thruk.cache');

###################################################
# save pid
my $pidfile  = __PACKAGE__->config->{'tmp_path'}.'/thruk.pid';
sub _remove_pid {
    if(defined $ENV{'THRUK_SRC'} and $ENV{'THRUK_SRC'} eq 'FastCGI') {
        if($pidfile && -f $pidfile) {
            my $pids = [split(/\s/mx, read_file($pidfile))];
            my $remaining = [];
            for my $pid (@{$pids}) {
                next if $pid == $$;
                next if kill(0, $pid) == 0;
                push @{$remaining}, $pid;
            }
            if(scalar @{$remaining} == 0) {
                unlink($pidfile)
            } else {
                open(my $fh, '>', $pidfile);
                print $fh join("\n", @{$remaining}),"\n";
                CORE::close($fh);
            }
        }
    }
    return;
}
if(defined $ENV{'THRUK_SRC'} and $ENV{'THRUK_SRC'} eq 'FastCGI') {
    open(my $fh, '>>', $pidfile) || warn("cannot write $pidfile: $!");
    print $fh $$."\n";
    Thruk::Utils::IO::close($fh, $pidfile);
    $SIG{INT}  = sub { _remove_pid(); exit; };
    $SIG{TERM} = sub { _remove_pid(); exit; };
}
END {
    _remove_pid();
};

###################################################
# create secret file
if(!defined $ENV{'THRUK_SRC'} or $ENV{'THRUK_SRC'} ne 'SCRIPTS') {
    my $var_path   = __PACKAGE__->config->{'var_path'} or die("no var path!");
    my $secretfile = $var_path.'/secret.key';
    unless(-s $secretfile) {
        my $digest = md5_hex(rand(1000).time());
        chomp($digest);
        open(my $fh, ">$secretfile") or warn("cannot write to $secretfile: $!");
        if(defined $fh) {
            print $fh $digest;
            Thruk::Utils::IO::close($fh, $secretfile);
        }
        __PACKAGE__->config->{'secret_key'} = $digest;
    } else {
        my $secret_key = read_file($secretfile);
        chomp($secret_key);
        __PACKAGE__->config->{'secret_key'} = $secret_key;
    }
}

###################################################
# set timezone
my $timezone = __PACKAGE__->config->{'use_timezone'};
if(defined $timezone) {
    $ENV{'TZ'} = $timezone;
    POSIX::tzset();
}

###################################################
# set installed server side includes
my $ssi_dir = __PACKAGE__->config->{'ssi_path'};
my (%ssi, $dh);
if(!-e $ssi_dir) {
    warn("cannot access ssi_path $ssi_dir: $!");
} else {
    opendir( $dh, $ssi_dir) or die "can't opendir '$ssi_dir': $!";
    for my $entry (readdir($dh)) {
        next if $entry eq '.' or $entry eq '..';
        next if $entry !~ /\.ssi$/mx;
        $ssi{$entry} = { name => $entry }
    }
    closedir $dh;
}
__PACKAGE__->config->{'ssi_includes'} = \%ssi;
__PACKAGE__->config->{'ssi_path'}     = $ssi_dir;

###################################################
# load and parse cgi.cfg into $c->config
unless(Thruk::Utils::read_cgi_cfg(undef, __PACKAGE__->config, __PACKAGE__->log)) {
    die("\n\n*****\nfailed to load cgi config: ".__PACKAGE__->config->{'cgi.cfg'}."\n*****\n\n");
}


###################################################
# Logging
my $log4perl_conf;
if(!defined $ENV{'THRUK_SRC'} or ($ENV{'THRUK_SRC'} ne 'CLI' and $ENV{'THRUK_SRC'} ne 'SCRIPTS')) {
    if(defined __PACKAGE__->config->{'log4perl_conf'} and ! -s __PACKAGE__->config->{'log4perl_conf'} ) {
        die("\n\n*****\nfailed to load log4perl config: ".__PACKAGE__->config->{'log4perl_conf'}.": ".$!."\n*****\n\n");
    }
    $log4perl_conf = __PACKAGE__->config->{'log4perl_conf'} || __PACKAGE__->config->{'home'}.'/log4perl.conf';
}
if(defined $log4perl_conf and -s $log4perl_conf) {
    __PACKAGE__->log(Log::Log4perl::Catalyst->new($log4perl_conf));
}
elsif(!__PACKAGE__->debug) {
    __PACKAGE__->log->levels( 'info', 'warn', 'error', 'fatal' );
}

###################################################
# SizeMe and other devel internals
if($ENV{'SIZEME'}) {
    # add signal handler to print memory information
    # ps -efl | grep perl | grep thruk_server.pl | awk '{print $4}' | xargs kill -USR1
    $SIG{'USR1'} = sub {
        printf(STDERR "mem:% 7s MB  before devel::sizeme\n", Thruk::Utils::get_memory_usage());
        eval {
            require Devel::SizeMe;
            Devel::SizeMe::perl_size();
        };
        print STDERR $@ if $@;
    }
}
if($ENV{'MALLINFO'}) {
    # add signal handler to print memory information
    # ps -efl | grep perl | grep thruk_server.pl | awk '{print $4}' | xargs kill -USR2
    $SIG{'USR2'} = sub {
        eval {
            require Devel::Mallinfo;
            require Data::Dumper;
            my $info = Devel::Mallinfo::mallinfo();
            printf STDERR "%s\n", '*******************************************';
            printf STDERR "%-30s    %5.1f %2s\n", 'arena',                              Thruk::Utils::reduce_number($info->{'arena'}, 'B');
            printf STDERR "   %-30s %5.1f %2s\n", 'bytes in use, ordinary blocks',  Thruk::Utils::reduce_number($info->{'uordblks'}, 'B');
            printf STDERR "   %-30s %5.1f %2s\n", 'bytes in use, small blocks',     Thruk::Utils::reduce_number($info->{'usmblks'}, 'B');
            printf STDERR "   %-30s %5.1f %2s\n", 'free bytes, ordinary blocks',    Thruk::Utils::reduce_number($info->{'fordblks'}, 'B');
            printf STDERR "   %-30s %5.1f %2s\n", 'free bytes, small blocks',       Thruk::Utils::reduce_number($info->{'fsmblks'}, 'B');
            printf STDERR "%-30s\n", 'total';
            printf STDERR "   %-30s %5.1f %2s\n", 'taken from the system',    Thruk::Utils::reduce_number($info->{'arena'} + $info->{'hblkhd'}, 'B');
            printf STDERR "   %-30s %5.1f %2s\n", 'in use by program',        Thruk::Utils::reduce_number($info->{'uordblks'} + $info->{'usmblks'} + $info->{'hblkhd'}, 'B');
            printf STDERR "   %-30s %5.1f %2s\n", 'free within program',      Thruk::Utils::reduce_number($info->{'fordblks'} + $info->{'fsmblks'}, 'B');
        };
        print STDERR $@ if $@;
    }
}

###################################################

=head1 METHODS

=head2 check_user_roles_wrapper

  check_user_roles_wrapper()

wrapper to avoid undef values in TT

=cut
sub check_user_roles_wrapper {
    my $self = shift;
    if($self->check_user_roles(@_)) {
        return 1;
    }
    return 0;
}

###################################################

=head2 found_leaks

called by CatalystX::LeakChecker and used for testing purposes only

=cut
sub found_leaks {
    my ($c, @leaks) = @_;
    return unless scalar @leaks > 0;
    my $sym = 'a';
    print STDERR "found leaks:\n";
    for my $leak (@leaks) {
        my $msg = (CatalystX::LeakChecker::format_leak($leak, \$sym));
        $c->log->error($msg);
        print STDERR $msg,"\n";
    }
    if(defined $ENV{'THRUK_SRC'} and $ENV{'THRUK_SRC'} eq 'TEST_LEAK') {
        die("tests die, exit otherwise");
    }
    # die() won't let our tests exit, so we use exit here
    exit 1;
    return;
}

###################################################

=head2 prepare_path

called by catalyst to strip path prefixes

=cut
sub prepare_path {
    my($c) = @_;
    $c->maybe::next::method();

    my @path_chunks = split m[/]mxo, $c->request->path, -1;
    return unless($path_chunks[1] and $path_chunks[1] eq 'thruk');

    my $site = shift @path_chunks;
    my $path = join('/', @path_chunks) || '/';
    $c->request->path($path);
    my $base = $c->request->base;
    $base->path($base->path.$site.'/');

    return;
}

=head1 SEE ALSO

L<Thruk::Controller::Root>, L<Catalyst>

=head1 AUTHOR

Sven Nierlein, 2009-2013, <sven.nierlein@consol.de>

=head1 LICENSE

This library is free software, you can redistribute it and/or modify
it under the same terms as Perl itself.

=cut

1;
